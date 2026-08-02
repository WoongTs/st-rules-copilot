import { Hono } from "hono";
import type { AuthRequest, ClientInfo, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { sha256Base64Url } from "./crypto";
import { readConnectionId } from "./cookies";
import { AppError } from "./errors";
import { reconnectUrl } from "./http-utils";
import { TokenStore } from "./token-store";
import type { Env } from "./types";

export const SMARTTHINGS_RULES_SCOPE = "smartthings:rules";

const CSRF_TTL_MILLISECONDS = 10 * 60 * 1_000;

export const oauthApp = new Hono<{ Bindings: Env }>();

oauthApp.get("/authorize", async (c) => {
  const oauth = requireOAuthHelpers(c.env);
  const authRequest = await oauth.parseAuthRequest(c.req.raw);
  const client = await requireClient(oauth, authRequest.clientId);
  requireSupportedAuthorizationRequest(c.req.url, client);
  const connectionId = readConnectionId(c.req.header("Cookie") ?? undefined);
  if (!connectionId) {
    return c.redirect(reconnectUrl(c.req.raw, c.env));
  }

  const pat = await new TokenStore(c.env).getPat(connectionId);
  if (!pat) {
    return c.redirect(reconnectUrl(c.req.raw, c.env));
  }

  const scopes = grantedScopes(authRequest.scope);
  const csrfToken = randomCsrfToken();
  const csrfRequestHash = await oauthRequestHash(c.req.url);
  const now = Date.now();
  const csrfCreated = await c.env.CONNECTION_GATE
    .getByName(connectionId)
    .createOAuthConsentNonce(
      csrfToken,
      csrfRequestHash,
      now + CSRF_TTL_MILLISECONDS,
      now
    );
  if (!csrfCreated) {
    throw new AppError(
      "SMARTTHINGS_PAT_EXPIRED",
      401,
      "SmartThings 연결이 만료되었습니다. 웹앱에서 PAT를 다시 연결하세요."
    );
  }

  return new Response(consentHtml(c.req.url, client, scopes, csrfToken), {
    status: 200,
    headers: consentHeaders()
  });
});

oauthApp.post("/authorize/approve", async (c) => {
  const oauth = requireOAuthHelpers(c.env);
  const authRequest = await oauth.parseAuthRequest(c.req.raw);
  const client = await requireClient(oauth, authRequest.clientId);
  requireSupportedAuthorizationRequest(c.req.url, client);
  const scopes = grantedScopes(authRequest.scope);
  const form = await c.req.raw.formData();
  const submittedCsrf = stringFormValue(form, "csrf_token");
  const csrfRequestHash = await oauthRequestHash(c.req.url);
  const connectionId = readConnectionId(c.req.header("Cookie") ?? undefined);
  if (!connectionId || !(await new TokenStore(c.env).getPat(connectionId))) {
    throw new AppError(
      "SMARTTHINGS_PAT_EXPIRED",
      401,
      "SmartThings 연결이 만료되었습니다. 웹앱에서 PAT를 다시 연결하세요."
    );
  }
  const csrfConsumed =
    submittedCsrf &&
    (await c.env.CONNECTION_GATE
      .getByName(connectionId)
      .consumeOAuthConsentNonce(submittedCsrf, csrfRequestHash, Date.now()));
  if (!csrfConsumed) {
    throw new AppError(
      "INVALID_REQUEST",
      403,
      "OAuth 승인 요청이 만료되었거나 올바르지 않습니다. 연결을 다시 시작하세요."
    );
  }

  const decision = stringFormValue(form, "decision");
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");

  if (decision === "deny") {
    return c.redirect(deniedRedirect(authRequest));
  }
  if (decision !== "approve") {
    throw new AppError("INVALID_REQUEST", 400, "OAuth 승인 여부를 선택하세요.");
  }

  const { redirectTo } = await oauth.completeAuthorization({
    request: authRequest,
    userId: connectionId,
    metadata: {
      clientId: client.clientId,
      clientName: client.clientName ?? "AI client"
    },
    scope: scopes,
    props: { connectionId }
  });

  return c.redirect(redirectTo);
});

function requireOAuthHelpers(env: Env): OAuthHelpers {
  if (!env.OAUTH_PROVIDER) {
    throw new AppError(
      "CONFIGURATION_ERROR",
      500,
      "OAuth Provider가 초기화되지 않았습니다."
    );
  }
  return env.OAUTH_PROVIDER;
}

async function requireClient(
  oauth: OAuthHelpers,
  clientId: string
): Promise<ClientInfo> {
  const client = await oauth.lookupClient(clientId);
  if (!client) {
    throw new AppError("INVALID_REQUEST", 400, "등록되지 않은 OAuth client입니다.");
  }
  return client;
}

function grantedScopes(requestedScopes: string[]): string[] {
  const scopes = requestedScopes.length > 0
    ? [...new Set(requestedScopes)]
    : [SMARTTHINGS_RULES_SCOPE];
  if (scopes.some((scope) => scope !== SMARTTHINGS_RULES_SCOPE)) {
    throw new AppError(
      "INVALID_REQUEST",
      400,
      "요청한 OAuth 권한을 지원하지 않습니다."
    );
  }
  return scopes;
}

function requireSupportedAuthorizationRequest(
  requestUrl: string,
  client: ClientInfo
): void {
  const url = new URL(requestUrl);
  const responseType = url.searchParams.get("response_type");
  const challenge = url.searchParams.get("code_challenge");
  const method = url.searchParams.get("code_challenge_method");
  if (responseType !== "code") {
    throw unsupportedAuthorizationRequest();
  }

  if (
    method === "S256" &&
    challenge !== null &&
    /^[A-Za-z0-9_-]{43}$/u.test(challenge)
  ) {
    return;
  }

  if (
    challenge === null &&
    method === null &&
    isConfidentialClient(client)
  ) {
    return;
  }

  throw unsupportedAuthorizationRequest();
}

function isConfidentialClient(client: ClientInfo): boolean {
  return Boolean(
    client.clientSecret &&
    ["client_secret_basic", "client_secret_post"].includes(
      client.tokenEndpointAuthMethod
    )
  );
}

function unsupportedAuthorizationRequest(): AppError {
  return new AppError(
    "INVALID_REQUEST",
    400,
    "공개 OAuth client는 PKCE S256 authorization code 방식을 사용해야 합니다."
  );
}

function deniedRedirect(authRequest: AuthRequest): string {
  const redirect = new URL(authRequest.redirectUri);
  redirect.searchParams.set("error", "access_denied");
  redirect.searchParams.set("error_description", "The user denied the authorization request.");
  if (authRequest.state) {
    redirect.searchParams.set("state", authRequest.state);
  }
  return redirect.toString();
}

function consentHtml(
  requestUrl: string,
  client: ClientInfo,
  scopes: string[],
  csrfToken: string
): string {
  const action = new URL(requestUrl);
  action.pathname = "/oauth/authorize/approve";
  action.searchParams.delete("approve");
  const clientName = client.clientName?.trim() || "AI client";

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SmartThings Rules Copilot 연결 승인</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 560px; margin: 48px auto; padding: 0 20px; line-height: 1.5; color: #172033; }
      .box { border: 1px solid #d8dee9; border-radius: 8px; padding: 24px; }
      .client { color: #44516a; overflow-wrap: anywhere; }
      .scope { background: #f4f7fb; border-radius: 6px; padding: 14px 16px; }
      .actions { display: flex; gap: 10px; margin-top: 20px; }
      button { border: 0; border-radius: 6px; padding: 10px 16px; font-weight: 700; cursor: pointer; }
      .approve { background: #2457d6; color: white; }
      .deny { background: #e8edf5; color: #172033; }
      code { overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <main class="box">
      <h1>연결 승인</h1>
      <p class="client"><strong>${escapeHtml(clientName)}</strong>에서 다음 권한을 요청했습니다.</p>
      <div class="scope">
        <strong>SmartThings Rules 조회 및 관리</strong>
        <p>SmartThings 위치·기기·Rules를 조회하고 Rules를 생성·수정·삭제하거나 활성·비활성 상태를 변경할 수 있습니다. 공식 GPT/Claude 지침은 최종 변경 내용과 대상을 보여주고 사용자의 명시적 확인을 받은 뒤 write 도구를 호출하도록 요구합니다. 서버는 외부 AI 채팅에서 실제 확인이 있었는지를 독립적으로 검증하지 않습니다.</p>
        <code>${escapeHtml(scopes.join(" "))}</code>
      </div>
      <form method="post" action="${escapeHtml(action.toString())}">
        <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}" />
        <div class="actions">
          <button class="approve" type="submit" name="decision" value="approve">연결 승인</button>
          <button class="deny" type="submit" name="decision" value="deny">취소</button>
        </div>
      </form>
    </main>
  </body>
</html>`;
}

function consentHeaders(): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy": [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "frame-ancestors 'none'",
      "base-uri 'none'"
    ].join("; "),
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
}

function randomCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function stringFormValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function oauthRequestHash(requestUrl: string): Promise<string> {
  const url = new URL(requestUrl);
  url.searchParams.delete("approve");
  return sha256Base64Url(url.search);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
