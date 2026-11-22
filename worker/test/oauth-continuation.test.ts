import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { getOAuthApi } from "@cloudflare/workers-oauth-provider";
import { oauthProviderOptions } from "../src";
import { OAUTH_CONTINUATION_TTL_SECONDS } from "../src/oauth-continuation";
import { TokenStore } from "../src/token-store";
import type { Env } from "../src/types";
import { MemoryKV } from "./memory-kv";
import {
  approveOAuthRequest,
  connectionIdFromCookie,
  cookiePair,
  jsonResponse,
  sha256Base64UrlForTest,
  workerRequest
} from "./test-helpers";

const PAT = "pat_continuation_test_1234567890";
const CALLBACK = "https://client.example/oauth/callback";
const STATE = "original-state +/&=한글";
const VERIFIER = "original-oauth-pkce-verifier-for-pat-continuation";

describe("OAuth authorization continuation after PAT setup", () => {
  let env: Env;
  let oauthKv: MemoryKV;

  beforeEach(() => {
    oauthKv = new MemoryKV();
    env = {
      APP_KV: new MemoryKV() as unknown as KVNamespace,
      OAUTH_KV: oauthKv as unknown as KVNamespace,
      PUBLIC_RESOURCE_RATE_LIMITER: { limit: async () => ({ success: true }) } as RateLimit,
      SIDE_EFFECT_RATE_LIMITER: { limit: async () => ({ success: true }) } as RateLimit,
      ASSETS: workerEnv.ASSETS,
      CONNECTION_GATE: workerEnv.CONNECTION_GATE,
      ST_TOKEN_ENC_KEY: "test-only-oauth-continuation-encryption-key",
      SMARTTHINGS_API_BASE: "https://smartthings.test/v1"
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [] })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function newAuthorization(): Promise<URL> {
    const registration = await workerRequest("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [CALLBACK],
        client_name: "Continuation test client",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      })
    }, env);
    expect(registration.status).toBe(201);
    const client = await registration.json() as { client_id: string };
    const authorization = new URL("http://localhost/oauth/authorize");
    authorization.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: CALLBACK,
      scope: "smartthings:rules",
      state: STATE,
      code_challenge: await sha256Base64UrlForTest(VERIFIER),
      code_challenge_method: "S256"
    }).toString();
    return authorization;
  }

  async function newSessionCookie(): Promise<string> {
    const session = await workerRequest("/api/session", { method: "POST" }, env);
    return cookiePair(session.headers.get("Set-Cookie") ?? "");
  }

  async function start(authorization: URL, existingCookie?: string) {
    const response = await workerRequest(authorization, {
      headers: existingCookie ? { Cookie: existingCookie } : {}
    }, env);
    expect(response.status).toBe(302);
    const setupUrl = new URL(response.headers.get("Location") ?? "");
    const continuation = new URLSearchParams(setupUrl.hash.slice(1)).get("oauth_continue") ?? "";
    expect(setupUrl.origin + setupUrl.pathname).toBe("http://localhost/connect");
    expect(setupUrl.search).toBe("");
    expect(continuation).toMatch(/^oc_/u);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const cookie = existingCookie ?? cookiePair(response.headers.get("Set-Cookie") ?? "");
    expect(cookie).toMatch(/^st_rule_copilot=conn_/u);
    return { continuation, cookie, response };
  }

  async function savePat(cookie: string) {
    const connected = await workerRequest("/api/smartthings/connect", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ pat: PAT })
    }, env);
    expect(connected.status).toBe(200);
    expect(await connected.json()).toMatchObject({ ok: true, connected: true });
  }

  function resume(continuation: string, cookie?: string, query = "") {
    return workerRequest(`/oauth/continue${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: new URLSearchParams({ continuation }).toString()
    }, env);
  }

  function expectNoAuthorization() {
    expect([...oauthKv.values.keys()].filter((key) => /^(?:grant|token):/u.test(key))).toEqual([]);
  }

  it.each([false, true])(
    "resumes the original state, redirect and PKCE after PAT setup (existing cookie: %s)",
    async (hasCookie) => {
      const authorization = await newAuthorization();
      const existingCookie = hasCookie ? await newSessionCookie() : undefined;
      const { continuation, cookie, response } = await start(authorization, existingCookie);
      if (hasCookie) {
        expect(response.headers.get("Set-Cookie")).toBeNull();
      } else {
        expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
        expect(response.headers.get("Set-Cookie")).toContain("SameSite=Lax");
      }
      expect(continuation).not.toContain(connectionIdFromCookie(cookie));
      expect(continuation).not.toContain(STATE);
      expect(continuation).not.toContain(CALLBACK);
      expectNoAuthorization();

      await savePat(cookie);
      const continued = await resume(continuation, cookie,
        "?redirect_uri=https%3A%2F%2Fevil.example%2Fcallback&state=changed&approve=true");
      expect(continued.status).toBe(303);
      const resumedUrl = new URL(continued.headers.get("Location") ?? "");
      expect(resumedUrl.toString()).toBe(authorization.toString());
      expect(continued.headers.get("Cache-Control")).toBe("no-store");
      expect(continued.headers.get("Referrer-Policy")).toBe("no-referrer");
      expectNoAuthorization();

      const consent = await workerRequest(resumedUrl, { headers: { Cookie: cookie } }, env);
      expect(consent.status).toBe(200);
      expect(await consent.text()).toContain("연결 승인");
      expectNoAuthorization();

      const { authorized } = await approveOAuthRequest(resumedUrl, cookie, env);
      expect(authorized.status).toBe(302);
      const callback = new URL(authorized.headers.get("Location") ?? "");
      expect(callback.origin + callback.pathname).toBe(CALLBACK);
      expect(callback.searchParams.get("state")).toBe(STATE);
      const code = callback.searchParams.get("code") ?? "";
      expect(code).not.toBe("");

      const exchange = (verifier: string) => workerRequest("/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: authorization.searchParams.get("client_id") ?? "",
          redirect_uri: CALLBACK,
          code_verifier: verifier
        }).toString()
      }, env);
      const wrongVerifier = await exchange("incorrect-pkce-verifier");
      expect(wrongVerifier.status).toBe(400);
      expect(await wrongVerifier.json()).toMatchObject({ error: "invalid_grant" });
      const token = await exchange(VERIFIER);
      expect(token.status).toBe(200);
      expect(await token.json()).toMatchObject({ token_type: "Bearer", scope: "smartthings:rules" });
    }
  );

  it("retains the original request when continued before a PAT has been saved", async () => {
    const { continuation, cookie } = await start(await newAuthorization());
    const response = await resume(continuation, cookie);
    expect(response.status).toBe(303);
    const setup = new URL(response.headers.get("Location") ?? "");
    expect(setup.pathname).toBe("/connect");
    expect(new URLSearchParams(setup.hash.slice(1)).get("oauth_continue")).toBe(continuation);
    expectNoAuthorization();
  });

  it("keeps PAT setup on the authorization origin when APP_BASE_URL uses another host", async () => {
    env.APP_BASE_URL = "https://public.example";
    const authorization = await newAuthorization();
    const { continuation, cookie, response } = await start(authorization);
    expect(new URL(response.headers.get("Location") ?? "").origin).toBe(authorization.origin);

    const missingPat = await resume(continuation, cookie);
    expect(missingPat.status).toBe(303);
    expect(new URL(missingPat.headers.get("Location") ?? "").origin).toBe(authorization.origin);

    await savePat(cookie);
    const continued = await resume(continuation, cookie);
    expect(continued.status).toBe(303);
    expect(continued.headers.get("Location")).toBe(authorization.toString());
    const consent = await workerRequest(authorization, { headers: { Cookie: cookie } }, env);
    expect(consent.status).toBe(200);
    expect(await consent.text()).toContain("연결 승인");
    expectNoAuthorization();
  });

  it.each(["missing", "different", "reset"])(
    "rejects a continuation with a %s browser connection and does not create a grant",
    async (caseName) => {
      const { continuation, cookie } = await start(await newAuthorization());
      await savePat(cookie);
      let changedCookie: string | undefined;
      if (caseName === "different") {
        changedCookie = await newSessionCookie();
        await savePat(changedCookie);
      } else if (caseName === "reset") {
        const reset = await workerRequest("/api/session/reset", {
          method: "POST", headers: { Cookie: cookie }
        }, env);
        changedCookie = cookiePair(reset.headers.get("Set-Cookie") ?? "");
      }
      const rejected = await resume(continuation, changedCookie);
      expect(rejected.status).toBe(400);
      expect(rejected.headers.get("Location")).toBeNull();
      expect(rejected.headers.get("Set-Cookie")).toBeNull();
      expect(await rejected.text()).toContain("ChatGPT 또는 Claude로 돌아가");
      expectNoAuthorization();
    }
  );

  it.each(["tampered", "malformed", "oversized", "expired"])(
    "rejects %s continuations without disclosing their contents or changing the PAT",
    async (caseName) => {
      const { continuation, cookie } = await start(await newAuthorization());
      await savePat(cookie);
      let submitted = continuation;
      if (caseName === "tampered") {
        submitted = `${continuation.slice(0, 4)}${continuation[4] === "A" ? "B" : "A"}${continuation.slice(5)}`;
      } else if (caseName === "malformed") {
        submitted = "https://evil.example/authorize?approve=true";
      } else if (caseName === "oversized") {
        submitted = `oc_${"A".repeat(17_000)}`;
      } else {
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + OAUTH_CONTINUATION_TTL_SECONDS * 1_000 + 1);
      }
      const rejected = await resume(submitted, cookie);
      expect(rejected.status).toBe(400);
      expect(rejected.headers.get("Location")).toBeNull();
      expect(rejected.headers.get("Cache-Control")).toBe("no-store");
      const body = await rejected.text();
      expect(body).toContain("AI 연결을 계속할 수 없습니다");
      expect(body).not.toContain(submitted);
      expect(await new TokenStore(env).getPat(connectionIdFromCookie(cookie))).toMatchObject({ pat: PAT });
      expectNoAuthorization();
    }
  );

  it("does not accept a continuation on a different origin", async () => {
    const { continuation, cookie } = await start(await newAuthorization());
    await savePat(cookie);
    const response = await workerRequest("https://other.example/oauth/continue", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ continuation }).toString()
    }, env);
    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
    expectNoAuthorization();
  });

  it("does not accept a continuation from the query string", async () => {
    const { continuation, cookie } = await start(await newAuthorization());
    const response = await workerRequest(`/oauth/continue?continuation=${encodeURIComponent(continuation)}`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: ""
    }, env);
    expect(response.status).toBe(400);
    expectNoAuthorization();
  });

  it("rejects an unsupported scope before offering PAT setup", async () => {
    const authorization = await newAuthorization();
    authorization.searchParams.set("scope", "unrelated:scope");
    const response = await workerRequest(authorization, undefined, env);
    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expectNoAuthorization();
  });

  it("returns missing PKCE to the validated callback before offering PAT setup", async () => {
    const authorization = await newAuthorization();
    authorization.searchParams.delete("code_challenge");
    authorization.searchParams.delete("code_challenge_method");
    const response = await workerRequest(authorization, undefined, env);
    expect(response.status).toBe(302);
    const callback = new URL(response.headers.get("Location") ?? "");
    expect(callback.origin + callback.pathname).toBe(CALLBACK);
    expect(callback.searchParams.get("error")).toBe("invalid_request");
    expect(callback.searchParams.get("state")).toBe(STATE);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expectNoAuthorization();
  });

  it("rejects resuming a fixed GPT client that no longer matches its configuration", async () => {
    const callback = "https://chatgpt.com/aip/g-test/oauth/callback";
    const updatedCallback = "https://chatgpt.com/aip/g-updated/oauth/callback";
    const oauth = getOAuthApi({ ...oauthProviderOptions, clientRegistrationTTL: undefined }, env);
    const client = await oauth.createClient({
      redirectUris: [callback],
      tokenEndpointAuthMethod: "client_secret_post"
    });
    env.GPT_ACTIONS_CLIENT_ID = client.clientId;
    env.GPT_ACTIONS_REDIRECT_URIS = JSON.stringify([callback]);
    const authorization = new URL("http://localhost/oauth/authorize");
    authorization.search = new URLSearchParams({
      response_type: "code",
      client_id: client.clientId,
      redirect_uri: callback,
      scope: "smartthings:rules"
    }).toString();

    const { continuation, cookie } = await start(authorization);
    await savePat(cookie);
    await oauth.updateClient(client.clientId, { redirectUris: [updatedCallback] });

    const response = await resume(continuation, cookie);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "CONFIGURATION_ERROR" });
    expect(response.headers.get("Location")).toBeNull();
    expect((await oauth.lookupClient(client.clientId))?.redirectUris).toEqual([updatedCallback]);
    expect(oauthKv.values.get(`client:${client.clientId}`)?.expiresAt).toBeUndefined();
    expectNoAuthorization();
  });

  it("still allows the user to deny the resumed authorization", async () => {
    const authorization = await newAuthorization();
    const { continuation, cookie } = await start(authorization);
    await savePat(cookie);
    const response = await resume(continuation, cookie);
    const resumedUrl = new URL(response.headers.get("Location") ?? "");
    const { authorized } = await approveOAuthRequest(resumedUrl, cookie, env, "deny");
    const callback = new URL(authorized.headers.get("Location") ?? "");
    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect(callback.searchParams.get("state")).toBe(STATE);
    expect(callback.searchParams.has("code")).toBe(false);
    expectNoAuthorization();
  });
});
