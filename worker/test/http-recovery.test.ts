import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { readReconnectTicket } from "../src/reconnect-ticket-store";
import { TokenStore } from "../src/token-store";
import type { Env } from "../src/types";
import { MemoryKV } from "./memory-kv";
import {
  connectionIdFromCookie,
  cookiePair,
  issueOAuthAccessToken,
  jsonResponse,
  workerRequest
} from "./test-helpers";

const ORIGINAL_PAT = "original_test_pat_123456";
const OTHER_PAT = "other_test_pat_123456";
const INVALID_PAT = "invalid_test_pat_123456";
const REPLACEMENT_PAT = "replacement_test_pat_123456";

describe("HTTP PAT recovery", () => {
  let env: Env;
  let rejectedPats: Set<string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rejectedPats = new Set([INVALID_PAT]);
    env = {
      APP_KV: new MemoryKV() as unknown as KVNamespace,
      OAUTH_KV: new MemoryKV() as unknown as KVNamespace,
      PUBLIC_RESOURCE_RATE_LIMITER: { limit: async () => ({ success: true }) },
      SIDE_EFFECT_RATE_LIMITER: { limit: async () => ({ success: true }) },
      ASSETS: workerEnv.ASSETS,
      CONNECTION_GATE: workerEnv.CONNECTION_GATE,
      ST_TOKEN_ENC_KEY: "test-only:http-recovery:encryption-key",
      SMARTTHINGS_API_BASE: "https://smartthings.test/v1"
    };
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const pat = new Headers(init?.headers).get("Authorization")?.replace(/^Bearer /u, "");
      if (pat && rejectedPats.has(pat)) return jsonResponse({ error: "unauthorized" }, 401);
      const url = new URL(input.toString());
      if (url.pathname === "/v1/locations") {
        return jsonResponse({ items: [{ locationId: "loc-1", name: "Home" }] });
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function connect(pat: string): Promise<string> {
    const session = await workerRequest("/api/session", { method: "POST" }, env);
    const cookie = cookiePair(session.headers.get("Set-Cookie") ?? "");
    const response = await workerRequest("/api/smartthings/connect", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ pat })
    }, env);
    expect(response.status).toBe(200);
    return cookie;
  }

  async function recoveryTicket(accessToken: string): Promise<string> {
    const response = await workerRequest("/action/status", {
      headers: { Authorization: `Bearer ${accessToken}` }
    }, env);
    expect(response.status).toBe(401);
    const body = await response.json() as { code: string; reconnectUrl: string };
    expect(body.code).toBe("SMARTTHINGS_AUTH_FAILED");
    const link = new URL(body.reconnectUrl);
    expect(link.search).toBe("");
    return new URLSearchParams(link.hash.slice(1)).get("reconnect") ?? "";
  }

  it("offers a bound recovery link when a stored PAT is revoked at SmartThings", async () => {
    const cookie = await connect(ORIGINAL_PAT);
    rejectedPats.add(ORIGINAL_PAT);
    const response = await workerRequest("/api/smartthings/status", {
      headers: { Cookie: cookie }
    }, env);
    expect(response.status).toBe(401);
    const body = await response.json() as { code: string; messageForUser: string; reconnectUrl: string };
    expect(body.code).toBe("SMARTTHINGS_AUTH_FAILED");
    expect(body.messageForUser).toContain(body.reconnectUrl);
    const ticket = new URLSearchParams(new URL(body.reconnectUrl).hash.slice(1)).get("reconnect") ?? "";
    expect((await readReconnectTicket(ticket, env)).connectionId).toBe(connectionIdFromCookie(cookie));
  });

  it("keeps ticket A after a bad PAT with cookie B and restores A without reauthorizing OAuth", async () => {
    const cookieA = await connect(ORIGINAL_PAT);
    const tokenA = await issueOAuthAccessToken(cookieA, env);
    rejectedPats.add(ORIGINAL_PAT);
    const reconnectTicket = await recoveryTicket(tokenA);
    const cookieB = await connect(OTHER_PAT);

    const rejected = await workerRequest("/api/smartthings/connect", {
      method: "POST",
      headers: { Cookie: cookieB, "Content-Type": "application/json" },
      body: JSON.stringify({ pat: INVALID_PAT, reconnectTicket })
    }, env);
    expect(rejected.status).toBe(401);
    const rejectedBody = await rejected.json() as { code: string; reconnectUrl?: string };
    expect(rejectedBody.code).toBe("SMARTTHINGS_AUTH_FAILED");
    expect(rejectedBody.reconnectUrl).toBeUndefined();
    expect(rejected.headers.get("Set-Cookie")).toBeNull();
    expect((await readReconnectTicket(reconnectTicket, env)).connectionId).toBe(connectionIdFromCookie(cookieA));

    const restored = await workerRequest("/api/smartthings/connect", {
      method: "POST",
      headers: { Cookie: cookieB, "Content-Type": "application/json" },
      body: JSON.stringify({ pat: REPLACEMENT_PAT, reconnectTicket })
    }, env);
    expect(restored.status).toBe(200);
    expect(connectionIdFromCookie(restored.headers.get("Set-Cookie") ?? "")).toBe(connectionIdFromCookie(cookieA));
    const store = new TokenStore(env);
    expect((await store.getPat(connectionIdFromCookie(cookieA)))?.pat).toBe(REPLACEMENT_PAT);
    expect((await store.getPat(connectionIdFromCookie(cookieB)))?.pat).toBe(OTHER_PAT);

    const status = await workerRequest("/action/status", {
      headers: { Authorization: `Bearer ${tokenA}` }
    }, env);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ structuredContent: { connected: true } });

    const replay = await workerRequest("/api/smartthings/connect", {
      method: "POST",
      headers: { Cookie: cookieB, "Content-Type": "application/json" },
      body: JSON.stringify({ pat: ORIGINAL_PAT, reconnectTicket })
    }, env);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ code: "RECONNECT_LINK_INVALID" });
  });

  it("does not create a browser-cookie recovery link when a submitted PAT is invalid", async () => {
    const cookie = await connect(OTHER_PAT);
    const response = await workerRequest("/api/smartthings/connect", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ pat: INVALID_PAT })
    }, env);
    expect(response.status).toBe(401);
    const body = await response.json() as { code: string; reconnectUrl?: string };
    expect(body.code).toBe("SMARTTHINGS_AUTH_FAILED");
    expect(body.reconnectUrl).toBeUndefined();
    expect((await new TokenStore(env).getPat(connectionIdFromCookie(cookie)))?.pat).toBe(OTHER_PAT);
  });

  it.each([403, 429, 500])("keeps HTTP %i separate from PAT authentication recovery", async (status) => {
    const cookie = await connect(ORIGINAL_PAT);
    fetchMock.mockImplementation(async () => jsonResponse({ error: "upstream failure" }, status));
    const response = await workerRequest("/api/smartthings/status", {
      headers: { Cookie: cookie }
    }, env);
    expect(response.status).toBe(status);
    const body = await response.json() as { code: string; reconnectUrl?: string };
    expect(body.code).not.toBe("SMARTTHINGS_PAT_EXPIRED");
    expect(body.code).not.toBe("SMARTTHINGS_AUTH_FAILED");
    expect(body.reconnectUrl).toBeUndefined();
  });
});
