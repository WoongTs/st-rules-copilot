import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { app } from "../src";
import { mcpOnlyToolNames, toolNames } from "../src/ai-instructions";
import { decryptReconnectTicket } from "../src/crypto";
import { TokenStore } from "../src/token-store";
import { reconnectUrlForConnection } from "../src/http-utils";
import type { Env } from "../src/types";
import { MemoryKV } from "./memory-kv";
import {
  connectionIdFromCookie,
  issueOAuthAccessToken,
  jsonResponse,
  switchOnRuleJson,
  workerRequest
} from "./test-helpers";

const PAT = "pat_recovery_test_value";

interface McpResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
}

describe("MCP PAT recovery", () => {
  let env: Env;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const unlimited = { limit: async () => ({ success: true }) } as RateLimit;
    env = {
      APP_KV: new MemoryKV() as unknown as KVNamespace,
      OAUTH_KV: new MemoryKV() as unknown as KVNamespace,
      PUBLIC_RESOURCE_RATE_LIMITER: unlimited,
      SIDE_EFFECT_RATE_LIMITER: unlimited,
      ASSETS: workerEnv.ASSETS,
      CONNECTION_GATE: workerEnv.CONNECTION_GATE,
      ST_TOKEN_ENC_KEY: "test-only-recovery-encryption-key",
      SMARTTHINGS_API_BASE: "https://smartthings.test/v1"
    };
    fetchMock = vi.fn(async () => jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function connection(withPat = true) {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    const connectionId = connectionIdFromCookie(cookie);
    if (withPat) await new TokenStore(env).savePat(connectionId, PAT);
    return { cookie, connectionId };
  }

  async function call(
    name: string,
    args: Record<string, unknown>,
    headers: Record<string, string>
  ): Promise<McpResult> {
    const response = await workerRequest("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...headers
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args }
      })
    }, env);
    expect(response.status).toBe(200);
    const text = await response.text();
    const json = response.headers.get("Content-Type")?.includes("application/json")
      ? text
      : text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    expect(json).toBeTruthy();
    const body = JSON.parse(json ?? "{}") as { result?: McpResult; error?: unknown };
    expect(body.error).toBeUndefined();
    expect(body.result).toBeDefined();
    return body.result!;
  }

  async function expectBoundLink(result: McpResult, connectionId: string) {
    const url = new URL(String(result.structuredContent.reconnectUrl));
    expect(url.pathname).toBe("/connect");
    expect(url.search).toBe("");
    const ticket = new URLSearchParams(url.hash.slice(1)).get("reconnect") ?? "";
    const decoded = await decryptReconnectTicket(ticket, env.ST_TOKEN_ENC_KEY);
    expect(decoded.connectionId).toBe(connectionId);
    return url;
  }

  it.each([
    [toolNames.getStatus, {}],
    [toolNames.listDevices, { locationId: "loc-1" }]
  ])("returns a bound recovery link from %s when the stored PAT is absent", async (name, args) => {
    const current = await connection(false);
    const result = await call(name, args, { Cookie: current.cookie });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("SMARTTHINGS_PAT_EXPIRED");
    await expectBoundLink(result, current.connectionId);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [toolNames.getStatus, {}],
    [toolNames.listLocations, {}],
    [toolNames.listDevices, { locationId: "loc-1" }]
  ])("preserves an upstream 401 and offers recovery from %s", async (name, args) => {
    const current = await connection();
    fetchMock.mockImplementation(async () => jsonResponse({ error: "Unauthorized" }, 401));
    const result = await call(name, args, { Cookie: current.cookie });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("SMARTTHINGS_AUTH_FAILED");
    await expectBoundLink(result, current.connectionId);
    expect((await new TokenStore(env).getPat(current.connectionId))?.pat).toBe(PAT);
  });

  it.each([
    [403, "SMARTTHINGS_PERMISSION_DENIED"],
    [429, "SMARTTHINGS_RATE_LIMITED"]
  ])("does not disguise HTTP %s as an expired PAT", async (status, code) => {
    const current = await connection();
    fetchMock.mockImplementation(async () => jsonResponse({ error: "denied" }, status));
    const result = await call(toolNames.listLocations, {}, { Cookie: current.cookie });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe(code);
    expect(result.structuredContent.reconnectUrl).toBeUndefined();
  });

  it("issues a link for the authenticated OAuth connection without contacting SmartThings", async () => {
    const current = await connection();
    const accessToken = await issueOAuthAccessToken(current.cookie, env);
    await new TokenStore(env).deletePat(current.connectionId);
    fetchMock.mockClear();
    const result = await call(mcpOnlyToolNames.getReconnectLink, {}, {
      Authorization: `Bearer ${accessToken}`
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.expiresInSeconds).toBe(600);
    await expectBoundLink(result, current.connectionId);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never substitutes an unbound connection page for a reset connection", async () => {
    const current = await connection();
    await new TokenStore(env).reset(current.connectionId);
    const result = await call(mcpOnlyToolNames.getReconnectLink, {}, { Cookie: current.cookie });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("RECONNECT_UNAVAILABLE");
    expect(result.structuredContent.reconnectUrl).toBeUndefined();
    await expect(reconnectUrlForConnection(
      new Request("http://localhost/mcp"), env, null
    )).rejects.toMatchObject({ code: "RECONNECT_UNAVAILABLE" });
  });

  it("keeps the PAT failure visible when recovery-link issuance is rate limited", async () => {
    const current = await connection(false);
    env.SIDE_EFFECT_RATE_LIMITER = { limit: async () => ({ success: false }) } as RateLimit;
    const result = await call(toolNames.getStatus, {}, { Cookie: current.cookie });
    expect(result.structuredContent.code).toBe("SMARTTHINGS_PAT_EXPIRED");
    expect(result.structuredContent.reconnectUrl).toBeUndefined();
    expect(result.structuredContent.messageForUser).toContain("잠시");
  });

  it("preserves a rejected status write and its evidence while adding recovery", async () => {
    const current = await connection();
    let requested = false;
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        requested = true;
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      return requested
        ? jsonResponse({ error: "Unauthorized" }, 401)
        : jsonResponse({ id: "rule-1", name: "Existing", status: "Enabled" });
    });
    const result = await call(toolNames.setRuleStatusConfirmed, {
      locationId: "loc-1", ruleId: "rule-1", targetStatus: "Disabled"
    }, { Cookie: current.cookie });
    expect(result.structuredContent).toMatchObject({
      ok: false,
      executionStatus: "rejected_by_smartthings",
      error: { code: "SMARTTHINGS_WRITE_REJECTED" },
      request: { method: "PUT" },
      response: { status: 401, body: { error: "Unauthorized" } },
      readback: { confirmed: false, status: 401 }
    });
    await expectBoundLink(result, current.connectionId);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });

  it("keeps successful creation unconfirmed after a readback 401 without replaying it", async () => {
    const current = await connection();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (init?.method === "POST") return jsonResponse({ id: "new-rule" }, 201);
      if (url.pathname === "/v1/rules/new-rule") return jsonResponse({ error: "Unauthorized" }, 401);
      return jsonResponse({ items: [] });
    });
    const result = await call(toolNames.createRuleConfirmed, {
      locationId: "loc-1", ruleJson: switchOnRuleJson()
    }, { Cookie: current.cookie });
    expect(result.structuredContent).toMatchObject({
      ok: false,
      executionStatus: "create_not_confirmed",
      request: { method: "POST", body: switchOnRuleJson() },
      response: { status: 201, body: { id: "new-rule" } },
      readback: { confirmed: false, status: 401 },
      error: { code: "READBACK_NOT_CONFIRMED" }
    });
    await expectBoundLink(result, current.connectionId);
    expect(String(result.structuredContent.messageForUser)).toContain("현재 규칙부터 조회");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("preserves a delete fallback authentication failure without losing its 403 detail evidence", async () => {
    const current = await connection();
    let deleted = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (init?.method === "DELETE") {
        deleted = true;
        return jsonResponse({ deleted: true });
      }
      if (url.pathname === "/v1/rules") return jsonResponse({ error: "Unauthorized" }, 401);
      return deleted
        ? jsonResponse({ error: "Forbidden" }, 403)
        : jsonResponse({ id: "rule-1", name: "Existing", status: "Enabled" });
    });
    const result = await call(toolNames.deleteRuleConfirmed, {
      locationId: "loc-1", ruleId: "rule-1"
    }, { Cookie: current.cookie });
    expect(result.structuredContent).toMatchObject({
      executionStatus: "delete_not_confirmed",
      response: { status: 200 },
      readback: {
        confirmed: false,
        status: 403,
        body: { error: "Forbidden" },
        error: { code: "SMARTTHINGS_AUTH_FAILED" }
      }
    });
    await expectBoundLink(result, current.connectionId);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });

  it("rejects unauthenticated MCP requests before issuing a connection link", async () => {
    const response = await workerRequest("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
        name: mcpOnlyToolNames.getReconnectLink, arguments: {}
      } })
    }, env);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("oauth-protected-resource");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
