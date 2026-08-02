import {
  getOAuthApi,
  OAuthError,
  OAuthProvider,
  type OAuthProviderOptions,
  type TokenExchangeCallbackOptions
} from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { z } from "zod";
import { buildSessionCookie, readConnectionId } from "./cookies";
import { AppError, toErrorBody } from "./errors";
import { randomId } from "./crypto";
import { actionApp } from "./action";
import { handleMcpRequest } from "./mcp";
import { oauthApp, SMARTTHINGS_RULES_SCOPE } from "./oauth";
import { readReconnectTicket } from "./reconnect-ticket-store";
import {
  getRuleReference,
  referenceFiltersFromUrl,
  searchRuleReferences
} from "./rule-references";
import { SmartThingsService } from "./service";
import { maybeConnection, readJson, reconnectUrlForRequest } from "./http-utils";
import { applyRequestGuards } from "./request-security";
import type { Env, OAuthAccessProps } from "./types";

export { ConnectionGate } from "./connection-gate";

const connectSchema = z.object({
  pat: z.string().trim().min(12),
  reconnectTicket: z.string().trim().min(1).optional()
});

const rulesQuerySchema = z.object({
  locationId: z.string().trim().min(1)
});

const devicesQuerySchema = z.object({
  locationId: z.string().trim().min(1).optional()
});

export const app = new Hono<{ Bindings: Env }>();

app.route("/action", actionApp);
app.route("/oauth", oauthApp);

app.all("/mcp", async (c) => {
  const connectionId = await maybeConnection(c.req.raw, c.env);
  if (!connectionId) {
    return oauthRequiredResponse(c.req.raw);
  }

  return handleMcpRequest(c.req.raw, c.env, c.executionCtx as ExecutionContext<unknown>);
});

app.post("/api/session", (c) => {
  ensureConnection(c.req.raw, (cookie) =>
    c.header("Set-Cookie", cookie)
  );
  return c.json({ ok: true });
});

app.post("/api/session/reset", async (c) => {
  const existing = readConnectionId(c.req.header("Cookie") ?? undefined);
  if (existing) {
    const service = new SmartThingsService(c.env);
    await service.resetConnection(existing);
    await revokeOAuthGrants(c.env, existing);
  }

  const connectionId = randomId("conn");
  c.header("Set-Cookie", buildSessionCookie(connectionId, c.req.url));
  return c.json({ ok: true, connected: false });
});

app.post("/api/smartthings/connect", async (c) => {
  const body = connectSchema.safeParse(await readJson(c.req.raw));
  if (!body.success) {
    throw new AppError(
      "INVALID_REQUEST",
      400,
      "SmartThings PAT를 입력한 뒤 다시 시도하세요."
    );
  }

  const reconnectTicket = body.data.reconnectTicket ?? "";
  const ticketConnection = reconnectTicket
    ? await readReconnectTicket(reconnectTicket, c.env)
    : null;

  const service = new SmartThingsService(c.env);
  if (ticketConnection) {
    const summary = await service.reconnect(
      ticketConnection.connectionId,
      ticketConnection.nonce,
      body.data.pat
    );
    c.header(
      "Set-Cookie",
      buildSessionCookie(ticketConnection.connectionId, c.req.url)
    );
    return c.json({ ok: true, ...summary });
  }

  const { connectionId } = ensureConnection(c.req.raw, (cookie) =>
    c.header("Set-Cookie", cookie)
  );
  const summary = await service.connect(connectionId, body.data.pat);
  return c.json({ ok: true, ...summary });
});

app.get("/api/smartthings/status", async (c) => {
  const { connectionId } = ensureConnection(c.req.raw, (cookie) =>
    c.header("Set-Cookie", cookie)
  );
  const service = new SmartThingsService(c.env);
  const status = await service.status(connectionId);
  return c.json({ ok: true, ...status });
});

app.get("/api/smartthings/locations", async (c) => {
  const { connectionId } = ensureConnection(c.req.raw, (cookie) =>
    c.header("Set-Cookie", cookie)
  );
  const service = new SmartThingsService(c.env);
  const locations = await service.listLocations(connectionId);
  return c.json({ ok: true, locations });
});

app.get("/api/smartthings/devices", async (c) => {
  const { connectionId } = ensureConnection(c.req.raw, (cookie) =>
    c.header("Set-Cookie", cookie)
  );
  const query = devicesQuerySchema.safeParse({
    locationId: c.req.query("locationId") || undefined
  });
  if (!query.success) {
    throw new AppError("INVALID_REQUEST", 400, "기기 목록 요청이 올바르지 않습니다.");
  }

  const service = new SmartThingsService(c.env);
  const devices = await service.listDevices(connectionId, query.data.locationId);
  return c.json({ ok: true, devices });
});

app.get("/api/smartthings/rules", async (c) => {
  const { connectionId } = ensureConnection(c.req.raw, (cookie) =>
    c.header("Set-Cookie", cookie)
  );
  const query = rulesQuerySchema.safeParse({
    locationId: c.req.query("locationId")
  });
  if (!query.success) {
    throw new AppError("INVALID_REQUEST", 400, "locationId를 선택하세요.");
  }

  const service = new SmartThingsService(c.env);
  const rules = await service.listRules(connectionId, query.data.locationId);
  return c.json({ ok: true, rules });
});

app.get("/api/smartthings/rules/:ruleId", async (c) => {
  const { connectionId } = ensureConnection(c.req.raw, (cookie) =>
    c.header("Set-Cookie", cookie)
  );
  const query = rulesQuerySchema.safeParse({
    locationId: c.req.query("locationId")
  });
  const ruleId = c.req.param("ruleId").trim();
  if (!query.success || !ruleId) {
    throw new AppError("INVALID_REQUEST", 400, "locationId와 ruleId를 선택하세요.");
  }

  const service = new SmartThingsService(c.env);
  const rule = await service.getRuleDetail(connectionId, query.data.locationId, ruleId);
  return c.json({ ok: true, rule });
});

app.get("/api/rule-references", (c) => {
  const references = searchRuleReferences(referenceFiltersFromUrl(c.req.url));
  return c.json({
    ok: true,
    references
  });
});

app.get("/api/rule-references/:referenceId", (c) => {
  const reference = getRuleReference(c.req.param("referenceId"));
  if (!reference) {
    throw new AppError(
      "NOT_FOUND",
      404,
      "요청한 Rule 예시 참조를 찾을 수 없습니다."
    );
  }

  return c.json({
    ok: true,
    reference
  });
});

app.get("/api/public/metrics", async (c) => {
  const rulesCreated = await c.env.APP_KV.get("metrics:rules_created:total");
  return c.json({
    ok: true,
    rulesCreated: rulesCreated && /^\d+$/u.test(rulesCreated) ? Number(rulesCreated) : 0
  });
});

app.delete("/api/smartthings/token", async (c) => {
  const { connectionId } = ensureConnection(c.req.raw, (cookie) =>
    c.header("Set-Cookie", cookie)
  );
  const service = new SmartThingsService(c.env);
  await service.deletePat(connectionId);
  return c.json({ ok: true });
});

app.notFound((c) =>
  c.json(
    {
      ok: false,
      code: "NOT_FOUND",
      messageForUser: "요청한 API를 찾을 수 없습니다."
    },
    404
  )
);

app.onError(async (error, c) => {
  let responseError: unknown = error;
  let reconnectUrl: string | undefined;
  if (error instanceof AppError && error.code === "SMARTTHINGS_PAT_EXPIRED") {
    try {
      reconnectUrl = await reconnectUrlForRequest(c.req.raw, c.env);
    } catch (reconnectError) {
      responseError = reconnectError;
    }
  }

  const status = responseError instanceof AppError ? responseError.status : 500;
  const headers = new Headers({
    "Content-Type": "application/json"
  });
  if (responseError instanceof AppError && responseError.code === "RATE_LIMITED") {
    headers.set("Cache-Control", "no-store");
    headers.set("Retry-After", "60");
  }
  return new Response(JSON.stringify(toErrorBody(responseError, reconnectUrl)), {
    status,
    headers
  });
});

function ensureConnection(
  request: Request,
  setCookie: (cookie: string) => void
): { connectionId: string } {
  const existing = readConnectionId(request.headers.get("Cookie") ?? undefined);
  if (existing) {
    return { connectionId: existing };
  }

  const connectionId = randomId("conn");
  setCookie(buildSessionCookie(connectionId, request.url));
  return { connectionId };
}

const protectedApiRoutes = [
  "/mcp",
  "/action/status",
  "/action/locations",
  "/action/devices",
  "/action/rules",
  "/action/capabilities/inspect-context"
];

const publicHandler = {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  }
} satisfies Pick<Required<ExportedHandler<Env>>, "fetch">;

const oauthApiHandler = {
  fetch(request, env, ctx) {
    const props = oauthAccessProps(ctx.props);
    if (!props) {
      return oauthAccessDenied(request, "invalid_token");
    }
    if (!props.scopes.includes(SMARTTHINGS_RULES_SCOPE)) {
      return oauthAccessDenied(request, "insufficient_scope");
    }

    const authenticatedEnv = Object.create(env) as Env;
    authenticatedEnv.AUTHENTICATED_CONNECTION_ID = props.connectionId;
    authenticatedEnv.AUTHENTICATED_SCOPES = props.scopes;
    return app.fetch(request, authenticatedEnv, ctx);
  }
} satisfies Pick<Required<ExportedHandler<Env>>, "fetch">;

export const oauthProviderOptions = {
  apiRoute: protectedApiRoutes,
  apiHandler: oauthApiHandler,
  defaultHandler: publicHandler,
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: [SMARTTHINGS_RULES_SCOPE],
  accessTokenTTL: 60 * 60,
  refreshTokenTTL: 30 * 24 * 60 * 60,
  clientRegistrationTTL: 30 * 24 * 60 * 60,
  allowImplicitFlow: false,
  // The provider treats a missing PKCE challenge as plain. The application
  // rejects explicit plain PKCE and permits omission only for confidential
  // clients that authenticate at the token endpoint.
  allowPlainPKCE: true,
  allowTokenExchangeGrant: false,
  clientIdMetadataDocumentEnabled: false,
  disallowPublicClientRegistration: false,
  resourceMetadata: {
    scopes_supported: [SMARTTHINGS_RULES_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "SmartThings Rules Copilot"
  },
  tokenExchangeCallback(options) {
    return tokenPropsForExchange(options);
  },
  onError() {
    // OAuth errors may contain client-controlled values. Keep production logs secret-free.
  }
} satisfies OAuthProviderOptions<Env>;

export const oauthProvider = new OAuthProvider<Env>(oauthProviderOptions);

export const worker: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const guarded = await applyRequestGuards(request, env);
    if (guarded.response) {
      return withSensitiveResponseHeaders(request, guarded.response);
    }
    const guardedRequest = guarded.request;

    const gptClientReconciled = await reconcileConfiguredGptOAuthClient(
      guardedRequest,
      env
    );
    if (gptClientReconciled) {
      return withSensitiveResponseHeaders(guardedRequest, gptClientReconciled);
    }

    if (
      hasBrowserConnection(guardedRequest) &&
      isProtectedApiPath(new URL(guardedRequest.url).pathname)
    ) {
      const response = await app.fetch(guardedRequest, env, ctx);
      return withSensitiveResponseHeaders(guardedRequest, response);
    }
    const response = await oauthProvider.fetch(guardedRequest, env, ctx);
    const normalized = await normalizeOAuthResponse(guardedRequest, response);
    return withSensitiveResponseHeaders(guardedRequest, normalized);
  }
};

function withSensitiveResponseHeaders(request: Request, response: Response): Response {
  const pathname = new URL(request.url).pathname;
  const sensitive =
    pathname === "/api/session" ||
    pathname === "/api/session/reset" ||
    pathname.startsWith("/api/smartthings/") ||
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname === "/action" ||
    pathname.startsWith("/action/") ||
    pathname === "/oauth" ||
    pathname.startsWith("/oauth/");

  if (!sensitive || response.headers.get("Cache-Control") === "no-store") {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function reconcileConfiguredGptOAuthClient(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/oauth/authorize") {
    return null;
  }

  const clientId = env.GPT_ACTIONS_CLIENT_ID?.trim();
  const redirectUris = configuredGptRedirectUris(env.GPT_ACTIONS_REDIRECT_URIS);
  const requestedRedirectUri = url.searchParams.get("redirect_uri");
  if (
    !clientId ||
    url.searchParams.get("client_id") !== clientId ||
    !requestedRedirectUri ||
    !redirectUris.includes(requestedRedirectUri)
  ) {
    return null;
  }

  const oauth = getOAuthApi(oauthProviderOptions, env);
  const client = await oauth.lookupClient(clientId);
  if (!client || sameStringSet(client.redirectUris, redirectUris)) {
    return null;
  }

  // GPT Builder can replace its Action callback identifier after OAuth
  // credentials are saved. Keep the confidential client secret and metadata,
  // and reconcile only the exact deploy-controlled OpenAI callback allowlist.
  await oauth.updateClient(clientId, { redirectUris });

  // OAuth KV may still return the previous client value inside the request that
  // performed the write. Start a fresh request so the first real user does not
  // see a transient redirect_uri validation failure.
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      Location: request.url
    }
  });
}

function configuredGptRedirectUris(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 2) {
    return [];
  }

  const redirectUris = [...new Set(parsed)];
  if (
    redirectUris.length !== parsed.length ||
    redirectUris.some((redirectUri) => !isAllowedGptRedirectUri(redirectUri))
  ) {
    return [];
  }
  return redirectUris as string[];
}

function isAllowedGptRedirectUri(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "chat.openai.com" || url.hostname === "chatgpt.com") &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      /^\/aip\/g-[A-Za-z0-9_-]+\/oauth\/callback$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && right.every((value) => left.includes(value));
}

async function normalizeOAuthResponse(
  request: Request,
  response: Response
): Promise<Response> {
  const tokenResponse = await normalizeOAuthTokenType(request, response);
  return normalizeOAuthMetadata(request, tokenResponse);
}

async function normalizeOAuthTokenType(
  request: Request,
  response: Response
): Promise<Response> {
  if (
    request.method !== "POST" ||
    new URL(request.url).pathname !== "/oauth/token" ||
    !response.ok ||
    !response.headers.get("Content-Type")?.includes("application/json")
  ) {
    return response;
  }

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (
    typeof body !== "object" ||
    body === null ||
    (body as { token_type?: unknown }).token_type !== "bearer"
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(
    JSON.stringify({
      ...body,
      token_type: "Bearer"
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers
    }
  );
}

async function normalizeOAuthMetadata(
  request: Request,
  response: Response
): Promise<Response> {
  if (
    request.method !== "GET" ||
    new URL(request.url).pathname !== "/.well-known/oauth-authorization-server" ||
    !response.ok ||
    !response.headers.get("Content-Type")?.includes("application/json")
  ) {
    return response;
  }

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (typeof body !== "object" || body === null) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(
    JSON.stringify({
      ...body,
      code_challenge_methods_supported: ["S256"]
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers
    }
  );
}

function tokenPropsForExchange(
  options: TokenExchangeCallbackOptions
): { accessTokenProps: OAuthAccessProps } {
  const connectionId = connectionIdFromGrantProps(options.props);
  if (!connectionId) {
    throw new OAuthError("invalid_grant", {
      description: "The authorization grant is missing its connection binding."
    });
  }
  return {
    accessTokenProps: {
      connectionId,
      scopes: [...new Set(options.requestedScope)]
    }
  };
}

function connectionIdFromGrantProps(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const connectionId = (value as { connectionId?: unknown }).connectionId;
  return typeof connectionId === "string" && connectionId ? connectionId : null;
}

function oauthAccessProps(value: unknown): OAuthAccessProps | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as { connectionId?: unknown; scopes?: unknown };
  if (
    typeof candidate.connectionId !== "string" ||
    !candidate.connectionId ||
    !Array.isArray(candidate.scopes) ||
    candidate.scopes.some((scope) => typeof scope !== "string")
  ) {
    return null;
  }
  return {
    connectionId: candidate.connectionId,
    scopes: candidate.scopes
  };
}

async function revokeOAuthGrants(env: Env, connectionId: string): Promise<void> {
  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) {
    return;
  }

  try {
    let cursor: string | undefined;
    do {
      const page = await oauth.listUserGrants(connectionId, {
        limit: 50,
        ...(cursor ? { cursor } : {})
      });
      await Promise.all(
        page.items.map((grant) => oauth.revokeGrant(grant.id, connectionId))
      );
      cursor = page.cursor;
    } while (cursor);
  } catch {
    // ConnectionGate is already inactive. OAuth KV revocation is defense in depth.
  }
}

function isProtectedApiPath(pathname: string): boolean {
  return protectedApiRoutes.some((route) => pathname.startsWith(route));
}

function hasBrowserConnection(request: Request): boolean {
  return Boolean(readConnectionId(request.headers.get("Cookie") ?? undefined));
}

function oauthRequiredResponse(request: Request): Response {
  const metadataUrl = `${new URL(request.url).origin}/.well-known/oauth-protected-resource/mcp`;
  return new Response(
    JSON.stringify({
      ok: false,
      code: "OAUTH_REQUIRED",
      messageForUser: "OAuth 연결이 필요합니다."
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"`
      }
    }
  );
}

function oauthAccessDenied(
  request: Request,
  error: "invalid_token" | "insufficient_scope"
): Response {
  const metadataUrl = `${new URL(request.url).origin}/.well-known/oauth-protected-resource${new URL(request.url).pathname}`;
  const status = error === "invalid_token" ? 401 : 403;
  return new Response(
    JSON.stringify({
      ok: false,
      code: error === "invalid_token" ? "OAUTH_REQUIRED" : "OAUTH_INSUFFICIENT_SCOPE",
      messageForUser: error === "invalid_token"
        ? "OAuth 연결이 필요합니다."
        : "요청한 OAuth 권한이 부족합니다."
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", error="${error}", scope="${SMARTTHINGS_RULES_SCOPE}"`
      }
    }
  );
}

export default worker;
