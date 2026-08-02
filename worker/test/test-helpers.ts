import { expect, vi } from "vitest";
import {
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { worker } from "../src";
import type { Env } from "../src/types";

export async function workerRequest(
  input: string | URL,
  init: RequestInit<IncomingRequestCfProperties<unknown>> | undefined,
  env: Env
): Promise<Response> {
  if (!worker.fetch) {
    throw new Error("Worker fetch handler is not configured.");
  }
  const url = input instanceof URL ? input : new URL(input, "http://localhost");
  const context = createExecutionContext();
  const request = new Request(url, init) as Request<
    unknown,
    IncomingRequestCfProperties<unknown>
  >;
  const response = await worker.fetch(request, env, context);
  await waitOnExecutionContext(context);
  return response;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

export function switchOnRuleJson() {
  return {
    name: "거실등 켜기",
    actions: [
      {
        command: {
          devices: ["dev-1"],
          commands: [
            {
              component: "main",
              capability: "switch",
              command: "on",
              arguments: []
            }
          ]
        }
      }
    ]
  };
}

export function copilotSwitchOnRuleJson() {
  return {
    ...switchOnRuleJson(),
    name: "[Copilot] 거실등 켜기"
  };
}

export function hasSmartThingsWriteCall(
  fetchMock: ReturnType<typeof vi.fn>
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return (
      url.pathname.startsWith("/v1/rules") &&
      ["DELETE", "PATCH", "POST", "PUT"].includes(method)
    );
  });
}

export function hasSmartThingsPostRuleCall(
  fetchMock: ReturnType<typeof vi.fn>
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return url.pathname === "/v1/rules" && method === "POST";
  });
}

export function hasSmartThingsDeleteRuleCall(
  fetchMock: ReturnType<typeof vi.fn>,
  ruleId: string
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return url.pathname === `/v1/rules/${ruleId}` && method === "DELETE";
  });
}

export function hasSmartThingsPutRuleCall(
  fetchMock: ReturnType<typeof vi.fn>,
  ruleId: string
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return url.pathname === `/v1/rules/${ruleId}` && method === "PUT";
  });
}

export function hasSmartThingsSetStatusCall(
  fetchMock: ReturnType<typeof vi.fn>,
  ruleId: string,
  operation: "enable" | "disable"
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return (
      url.pathname === `/v1/rules/${ruleId}/status/${operation}` &&
      method === "PUT"
    );
  });
}

export function hasBodylessSmartThingsSetStatusCall(
  fetchMock: ReturnType<typeof vi.fn>,
  ruleId: string,
  operation: "enable" | "disable"
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const requestInit = init as RequestInit | undefined;
    const method = (requestInit?.method ?? "GET").toUpperCase();
    return (
      url.pathname === `/v1/rules/${ruleId}/status/${operation}` &&
      method === "PUT" &&
      requestInit?.body === undefined
    );
  });
}

export function hasSmartThingsRuleDetailCall(
  fetchMock: ReturnType<typeof vi.fn>,
  ruleId: string
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return url.pathname === `/v1/rules/${ruleId}` && method === "GET";
  });
}

export function hasSmartThingsDeviceListCall(
  fetchMock: ReturnType<typeof vi.fn>
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return url.pathname === "/v1/devices" && method === "GET";
  });
}

export function hasSmartThingsRuleListCall(
  fetchMock: ReturnType<typeof vi.fn>
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return url.pathname === "/v1/rules" && method === "GET";
  });
}

export function hasCapabilityDefinitionCall(
  fetchMock: ReturnType<typeof vi.fn>
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return /^\/v1\/capabilities\/[^/]+\/\d+$/u.test(url.pathname) && method === "GET";
  });
}

export function hasCapabilityStatusCall(
  fetchMock: ReturnType<typeof vi.fn>
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return /\/components\/[^/]+\/capabilities\/[^/]+\/status$/u.test(url.pathname) && method === "GET";
  });
}

export function hasCapabilityPresentationCall(
  fetchMock: ReturnType<typeof vi.fn>
): boolean {
  return fetchMock.mock.calls.some(([input, init]) => {
    const url = new URL(input.toString());
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return /^\/v1\/capabilities\/[^/]+\/\d+\/presentation$/u.test(url.pathname) && method === "GET";
  });
}

export async function sha256Base64UrlForTest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function connectionIdFromCookie(cookie: string): string {
  const match = /(?:^|;\s*)st_rule_copilot=([^;]+)/u.exec(cookie);
  expect(match?.[1]).toBeTruthy();
  return decodeURIComponent(match?.[1] ?? "");
}

export async function issueOAuthAccessToken(
  cookie: string,
  env: Env
): Promise<string> {
  const registered = await workerRequest(
    "/oauth/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["https://client.example/callback"],
        client_name: "Rules Copilot test client",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post"
      })
    },
    env
  );
  const client = (await registered.json()) as {
    client_id: string;
    client_secret: string;
  };

  const codeVerifier = "test-oauth-code-verifier";
  const codeChallenge = await sha256Base64UrlForTest(codeVerifier);
  const authorizeUrl = new URL("http://localhost/oauth/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client.client_id);
  authorizeUrl.searchParams.set("redirect_uri", "https://client.example/callback");
  authorizeUrl.searchParams.set("scope", "smartthings:rules");
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const { authorized } = await approveOAuthRequest(authorizeUrl, cookie, env);
  const redirect = new URL(authorized.headers.get("Location") ?? "");
  const code = redirect.searchParams.get("code") ?? "";

  const token = await workerRequest(
    "/oauth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "https://client.example/callback",
        client_id: client.client_id,
        client_secret: client.client_secret,
        code_verifier: codeVerifier
      }).toString()
    },
    env
  );
  const tokenBody = (await token.json()) as {
    access_token: string;
  };
  return tokenBody.access_token;
}

export function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

export async function approveOAuthRequest(
  authorizeUrl: URL,
  sessionCookie: string,
  env: Env,
  decision: "approve" | "deny" = "approve"
): Promise<{
  consent: Response;
  consentBody: string;
  csrfToken: string;
  authorized: Response;
}> {
  const consent = await workerRequest(
    authorizeUrl,
    { headers: { Cookie: cookiePair(sessionCookie) } },
    env
  );
  const consentBody = await consent.text();
  const csrfToken = /name="csrf_token" value="([^"]+)"/u.exec(consentBody)?.[1];
  if (!csrfToken) {
    throw new Error("OAuth consent response did not include CSRF state.");
  }

  const approvalUrl = new URL(authorizeUrl);
  approvalUrl.pathname = "/oauth/authorize/approve";
  const authorized = await workerRequest(
    approvalUrl,
    {
      method: "POST",
      headers: {
        Cookie: cookiePair(sessionCookie),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        csrf_token: csrfToken,
        decision
      }).toString()
    },
    env
  );
  return { consent, consentBody, csrfToken, authorized };
}
