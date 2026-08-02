import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { app } from "../src";
import { readConnectionId } from "../src/cookies";
import { decryptReconnectTicket } from "../src/crypto";
import { RECONNECT_TICKET_TTL_SECONDS } from "../src/reconnect-ticket-store";
import { PAT_TTL_SECONDS } from "../src/token-store";
import {
  enforceSideEffectRateLimit,
  REQUEST_BODY_LIMITS,
  requestBodyLimit
} from "../src/request-security";
import { toolNames } from "../src/tool-contracts";
import { SmartThingsClient } from "../src/smartthings";
import {
  gptBuilderInstructions,
  mcpServerInstructions,
  toolDescriptions,
  toolInstructions
} from "../src/ai-instructions";
import { MemoryKV } from "./memory-kv";
import {
  approveOAuthRequest,
  connectionIdFromCookie,
  cookiePair,
  copilotSwitchOnRuleJson,
  hasBodylessSmartThingsSetStatusCall,
  hasCapabilityDefinitionCall,
  hasCapabilityPresentationCall,
  hasCapabilityStatusCall,
  hasSmartThingsDeleteRuleCall,
  hasSmartThingsDeviceListCall,
  hasSmartThingsPostRuleCall,
  hasSmartThingsPutRuleCall,
  hasSmartThingsRuleDetailCall,
  hasSmartThingsRuleListCall,
  hasSmartThingsSetStatusCall,
  hasSmartThingsWriteCall,
  issueOAuthAccessToken,
  jsonResponse,
  sha256Base64UrlForTest,
  switchOnRuleJson,
  workerRequest
} from "./test-helpers";
import type { Env } from "../src/types";

const PAT = "pat_test_1234567890";

describe("SmartThings Rules Copilot Worker", () => {
  let kv: MemoryKV;
  let oauthKv: MemoryKV;
  let env: Env;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    kv = new MemoryKV();
    oauthKv = new MemoryKV();
    env = {
      APP_KV: kv as unknown as KVNamespace,
      OAUTH_KV: oauthKv as unknown as KVNamespace,
      PUBLIC_RESOURCE_RATE_LIMITER: memoryRateLimit(Number.MAX_SAFE_INTEGER),
      SIDE_EFFECT_RATE_LIMITER: memoryRateLimit(Number.MAX_SAFE_INTEGER),
      ASSETS: workerEnv.ASSETS,
      CONNECTION_GATE: workerEnv.CONNECTION_GATE,
      ST_TOKEN_ENC_KEY: ["test-only", "not-a-secret", "encryption-key"].join(":"),
      SMARTTHINGS_API_BASE: "https://smartthings.test/v1"
    };

    let createdRule: Record<string, unknown> | null = null;
    let updatedRule: Record<string, unknown> | null = null;
    const deletedRuleIds = new Set<string>();
    let ruleStatus: "Enabled" | "Disabled" = "Enabled";
    let keepDeletedRuleListed = false;
    let rejectedDeleteRequested = false;
    let statusNotConfirmedRequested = false;
    let rejectedStatusRequested = false;

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.pathname === "/v1/locations") {
        return jsonResponse({
          items: [{ locationId: "loc-1", name: "Home" }]
        });
      }

      if (url.pathname === "/v1/devices") {
        return jsonResponse({
          items: [
            {
              deviceId: "dev-1",
              label: "거실등",
              name: "Living room light",
              locationId: "loc-1",
              roomId: "room-1",
              components: [
                {
                  id: "main",
                  capabilities: [
                    { id: "airConditionerMode", version: 1 },
                    { id: "contactSensor", version: 1 },
                    { id: "switch", version: 1 },
                    { id: "switchLevel", version: 1 },
                    { id: "lock", version: 1 }
                  ]
                }
              ]
            }
          ]
        });
      }

      if (url.pathname === "/v1/locations/loc-1/rooms") {
        return jsonResponse({
          items: [{ roomId: "room-1", name: "거실" }]
        });
      }

      if (url.pathname === "/v1/capabilities/switch/1") {
        return jsonResponse({
          id: "switch",
          version: 1,
          status: "live",
          name: "Switch",
          attributes: {
            switch: {
              schema: {
                properties: {
                  value: { type: "string", enum: ["on", "off"] }
                }
              },
              enumCommands: ["on", "off"]
            }
          },
          commands: {
            on: { arguments: [] },
            off: { arguments: [] }
          }
        });
      }

      if (url.pathname === "/v1/capabilities/contactSensor/1") {
        return jsonResponse({
          id: "contactSensor",
          version: 1,
          status: "live",
          name: "Contact Sensor",
          attributes: {
            contact: {
              schema: {
                properties: {
                  value: { type: "string", enum: ["open", "closed"] }
                }
              }
            }
          },
          commands: {}
        });
      }

      if (url.pathname === "/v1/capabilities/switchLevel/1") {
        return jsonResponse({
          id: "switchLevel",
          version: 1,
          status: "live",
          name: "Switch Level",
          attributes: {
            level: {
              schema: {
                properties: {
                  value: { type: "integer", minimum: 0, maximum: 100 },
                  unit: { type: "string", enum: ["%"] }
                }
              },
              setter: "setLevel"
            }
          },
          commands: {
            setLevel: {
              arguments: [
                {
                  name: "level",
                  optional: false,
                  schema: { type: "integer", minimum: 0, maximum: 100 }
                }
              ]
            }
          }
        });
      }

      if (url.pathname === "/v1/capabilities/airConditionerMode/1") {
        return jsonResponse({
          id: "airConditionerMode",
          version: 1,
          status: "live",
          name: "Air Conditioner Mode",
          attributes: {
            airConditionerMode: {
              schema: {
                properties: {
                  value: { type: "string", maxLength: 255 }
                }
              },
              setter: "setAirConditionerMode"
            }
          },
          commands: {
            setAirConditionerMode: {
              arguments: [
                {
                  name: "mode",
                  optional: false,
                  schema: { type: "string", maxLength: 255 }
                }
              ]
            }
          }
        });
      }

      if (
        url.pathname ===
        "/v1/devices/dev-1/components/main/capabilities/switch/status"
      ) {
        return jsonResponse({
          switch: { value: "off", timestamp: "2026-06-22T01:00:00.000Z" }
        });
      }

      if (
        url.pathname ===
        "/v1/devices/dev-1/components/main/capabilities/contactSensor/status"
      ) {
        return jsonResponse({
          contact: { value: "closed", timestamp: "2026-06-22T01:01:00.000Z" }
        });
      }

      if (
        url.pathname ===
        "/v1/devices/dev-1/components/main/capabilities/switchLevel/status"
      ) {
        return jsonResponse({
          level: { value: 50, unit: "%", timestamp: "2026-06-22T01:02:00.000Z" }
        });
      }

      if (
        url.pathname ===
        "/v1/devices/dev-1/components/main/capabilities/airConditionerMode/status"
      ) {
        return jsonResponse({
          availableAcModes: { value: [], timestamp: "2026-06-22T01:03:00.000Z" },
          supportedAcModes: {
            value: ["aIComfort", "cool", "dry", "wind"],
            timestamp: "2026-04-10T03:27:39.469Z"
          },
          airConditionerMode: {
            value: "aIComfort",
            timestamp: "2026-06-22T05:17:55.132Z"
          }
        });
      }

      if (url.pathname === "/v1/capabilities/airConditionerMode/1/presentation") {
        return jsonResponse({
          id: "airConditionerMode",
          version: 1,
          automation: {
            actions: [
              {
                label: "온도조절 모드",
                displayType: "list",
                list: {
                  command: "setAirConditionerMode",
                  supportedValues: "supportedAcModes.value",
                  alternatives: [{ key: "cool", value: "냉방" }]
                }
              }
            ],
            conditions: []
          },
          dashboard: { states: [] },
          detailView: []
        });
      }

      if (
        url.pathname === "/v1/rules" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "GET"
      ) {
        const items: Record<string, unknown>[] = deletedRuleIds.has("rule-1")
          ? []
          : [
              {
                id: "rule-1",
                name:
                  typeof updatedRule?.name === "string"
                    ? updatedRule.name
                    : "밤 11시 거실등 끄기",
                status: ruleStatus
              }
            ];
        if (createdRule) {
          items.push({
            id: "rule-created",
            name:
              typeof createdRule.name === "string"
                ? createdRule.name
              : "[Copilot] 생성된 Rule"
          });
        }
        if (keepDeletedRuleListed) {
          items.push({
            id: "rule-still-listed",
            name: "삭제 후에도 남은 Rule"
          });
        }
        if (rejectedDeleteRequested) {
          items.push({
            id: "rule-delete-rejected",
            name: "SmartThings가 삭제를 거부한 Rule"
          });
        }
        if (statusNotConfirmedRequested) {
          items.push({
            id: "rule-status-not-confirmed",
            name: "상태 확인이 실패한 Rule",
            status: "Enabled"
          });
        }
        if (rejectedStatusRequested) {
          items.push({
            id: "rule-status-rejected",
            name: "SmartThings가 상태 변경을 거부한 Rule",
            status: "Enabled"
          });
        }
        return jsonResponse({
          items
        });
      }

      if (
        url.pathname === "/v1/rules" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "POST"
      ) {
        const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
        if (requestBody.name === "[Copilot] SmartThings rejects this") {
          return jsonResponse(
            {
              error: {
                code: "ConstraintViolationError",
                message: "actions[0] is not accepted by SmartThings"
              }
            },
            400
          );
        }

        createdRule = requestBody;
        return jsonResponse({ id: "rule-created", ...requestBody }, 201);
      }

      if (
        url.pathname === "/v1/rules/rule-1" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "GET"
      ) {
        if (deletedRuleIds.has("rule-1")) {
          return jsonResponse({ error: "not found" }, 404);
        }

        if (updatedRule) {
          return jsonResponse({
            id: "rule-1",
            ...updatedRule,
            name:
              typeof updatedRule.name === "string"
                ? updatedRule.name
                : "수정된 Rule",
            status: ruleStatus
          });
        }

        return jsonResponse({
          id: "rule-1",
          name: "밤 11시 거실등 끄기",
          status: ruleStatus,
          actions: [
            {
              every: {
                specific: {
                  reference: "Noon",
                  offset: {
                    value: {
                      integer: -60
                    },
                    unit: "Minute"
                  }
                }
              }
            }
          ]
        });
      }

      if (
        url.pathname === "/v1/rules/rule-created" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "GET"
      ) {
        return jsonResponse({
          id: "rule-created",
          ...(createdRule ?? {}),
          name:
            typeof createdRule?.name === "string"
              ? createdRule.name
              : "[Copilot] 생성된 Rule"
        });
      }

      if (
        url.pathname === "/v1/rules/rule-1" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "PUT"
      ) {
        const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
        if (requestBody.name === "[Copilot] SmartThings rejects update") {
          return jsonResponse(
            {
              error: {
                code: "ConstraintViolationError",
                message: "updated actions[0] is not accepted by SmartThings"
              }
            },
            400
          );
        }

        updatedRule = requestBody;
        return jsonResponse({ id: "rule-1", ...requestBody }, 200);
      }

      if (
        url.pathname === "/v1/rules/rule-still-listed" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "GET"
      ) {
        return jsonResponse({
          id: "rule-still-listed",
          name: "삭제 후에도 남은 Rule",
          actions: []
        });
      }

      if (
        url.pathname === "/v1/rules/rule-delete-rejected" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "GET"
      ) {
        return jsonResponse({
          id: "rule-delete-rejected",
          name: "SmartThings가 삭제를 거부한 Rule",
          actions: []
        });
      }

      if (
        url.pathname === "/v1/rules/rule-status-not-confirmed" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "GET"
      ) {
        return jsonResponse({
          id: "rule-status-not-confirmed",
          name: "상태 확인이 실패한 Rule",
          status: "Enabled",
          actions: []
        });
      }

      if (
        url.pathname === "/v1/rules/rule-status-rejected" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "GET"
      ) {
        return jsonResponse({
          id: "rule-status-rejected",
          name: "SmartThings가 상태 변경을 거부한 Rule",
          status: "Enabled",
          actions: []
        });
      }

      if (
        url.pathname === "/v1/rules/rule-1" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "DELETE"
      ) {
        deletedRuleIds.add("rule-1");
        return jsonResponse(null, 200);
      }

      if (
        url.pathname === "/v1/rules/rule-still-listed" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "DELETE"
      ) {
        keepDeletedRuleListed = true;
        return jsonResponse(null, 200);
      }

      if (
        url.pathname === "/v1/rules/rule-delete-rejected" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "DELETE"
      ) {
        rejectedDeleteRequested = true;
        return jsonResponse(
          {
            error: {
              code: "ForbiddenError",
              message: "Rule delete is not allowed for this token."
            }
          },
          403
        );
      }

      if (
        url.pathname === "/v1/rules/rule-1/status/enable" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "PUT"
      ) {
        ruleStatus = "Enabled";
        return jsonResponse(null, 200);
      }

      if (
        url.pathname === "/v1/rules/rule-1/status/disable" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "PUT"
      ) {
        ruleStatus = "Disabled";
        return jsonResponse(null, 200);
      }

      if (
        url.pathname === "/v1/rules/rule-status-not-confirmed/status/disable" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "PUT"
      ) {
        statusNotConfirmedRequested = true;
        return jsonResponse(null, 200);
      }

      if (
        url.pathname === "/v1/rules/rule-status-rejected/status/disable" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "PUT"
      ) {
        rejectedStatusRequested = true;
        return jsonResponse(
          {
            error: {
              code: "ForbiddenError",
              message: "Rule status change is not allowed for this token."
            }
          },
          403
        );
      }

      return jsonResponse({ error: "not found" }, 404);
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an HttpOnly session cookie", async () => {
    const response = await app.request("/api/session", { method: "POST" }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=2592000");
    expect(response.headers.get("Set-Cookie")).not.toContain("; ;");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("accepts only generated connection ID cookies and fails closed on malformed encoding", () => {
    const validConnectionId = "conn_0123456789ABCDEFGHIJKL";
    expect(readConnectionId(`st_rule_copilot=${validConnectionId}`)).toBe(
      validConnectionId
    );
    expect(readConnectionId("st_rule_copilot=conn-other-actor")).toBeNull();
    expect(readConnectionId("st_rule_copilot=%E0%A4%A")).toBeNull();
    expect(readConnectionId(`st_rule_copilot=${"x".repeat(129)}`)).toBeNull();
  });

  it("rate limits only public resource creation requests by actor", async () => {
    const limitedEnv = Object.create(env) as Env;
    limitedEnv.PUBLIC_RESOURCE_RATE_LIMITER = memoryRateLimit(30);

    for (let index = 0; index < 30; index += 1) {
      const accepted = await workerRequest(
        "/api/session",
        {
          method: "POST",
          headers: { "CF-Connecting-IP": "198.51.100.10" }
        },
        limitedEnv
      );
      expect(accepted.status).toBe(200);
    }

    const limited = await workerRequest(
      "/api/session",
      {
        method: "POST",
        headers: { "CF-Connecting-IP": "198.51.100.10" }
      },
      limitedEnv
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
    expect(await limited.json()).toMatchObject({
      ok: false,
      code: "RATE_LIMITED"
    });

    const differentActor = await workerRequest(
      "/api/session/reset",
      {
        method: "POST",
        headers: { Cookie: "st_rule_copilot=conn-other-actor" }
      },
      limitedEnv
    );
    expect(differentActor.status).toBe(200);

    limitedEnv.PUBLIC_RESOURCE_RATE_LIMITER = memoryRateLimit(0);
    const oauthLimited = await workerRequest(
      "/oauth/token",
      {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "198.51.100.12",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ client_id: "client-1" }).toString()
      },
      limitedEnv
    );
    expect(oauthLimited.status).toBe(429);
    expect(await oauthLimited.json()).toMatchObject({
      error: "temporarily_unavailable"
    });

    const ordinaryRead = await workerRequest("/api/public/metrics", {}, limitedEnv);
    expect(ordinaryRead.status).toBe(200);
  });

  it("keeps costly reset and connect requests in an IP route bucket across cookie rotation", async () => {
    const limitedEnv = Object.create(env) as Env;
    limitedEnv.PUBLIC_RESOURCE_RATE_LIMITER = memoryRateLimit(2);

    for (const suffix of ["A", "B"]) {
      const accepted = await workerRequest(
        "/api/session/reset",
        {
          method: "POST",
          headers: {
            "CF-Connecting-IP": "198.51.100.20",
            Cookie: `st_rule_copilot=conn_0123456789ABCDEFGHIJK${suffix}`
          }
        },
        limitedEnv
      );
      expect(accepted.status).toBe(200);
    }

    const limited = await workerRequest(
      "/api/session/reset",
      {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "198.51.100.20",
          Cookie: "st_rule_copilot=conn_0123456789ABCDEFGHIJKC"
        }
      },
      limitedEnv
    );
    expect(limited.status).toBe(429);
  });

  it("uses the OAuth client before a browser cookie for token rate limits", async () => {
    const limitedEnv = Object.create(env) as Env;
    limitedEnv.PUBLIC_RESOURCE_RATE_LIMITER = memoryRateLimit(1);
    const tokenRequest = (connectionId: string) =>
      workerRequest(
        "/oauth/token",
        {
          method: "POST",
          headers: {
            Cookie: `st_rule_copilot=${connectionId}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({ client_id: "shared-client" }).toString()
        },
        limitedEnv
      );

    expect((await tokenRequest("conn_0123456789ABCDEFGHIJKA")).status).not.toBe(429);
    expect((await tokenRequest("conn_0123456789ABCDEFGHIJKB")).status).toBe(429);
  });

  it("keeps OAuth token requests in an IP route bucket across client ID rotation", async () => {
    const limitedEnv = Object.create(env) as Env;
    limitedEnv.PUBLIC_RESOURCE_RATE_LIMITER = memoryRateLimit(30);
    const tokenRequest = (clientId: string) =>
      workerRequest(
        "/oauth/token",
        {
          method: "POST",
          headers: {
            "CF-Connecting-IP": "198.51.100.21",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({ client_id: clientId }).toString()
        },
        limitedEnv
      );

    for (let index = 1; index <= 30; index += 1) {
      expect((await tokenRequest(`rotating-client-${index}`)).status).not.toBe(429);
    }
    expect((await tokenRequest("rotating-client-31")).status).toBe(429);
  });

  it("marks sensitive dynamic responses as no-store", async () => {
    const session = await workerRequest("/api/session", { method: "POST" }, env);
    expect(session.headers.get("Cache-Control")).toBe("no-store");

    const actionSchema = await workerRequest("/action/openapi.json", {}, env);
    expect(actionSchema.headers.get("Cache-Control")).toBe("no-store");

    const publicMetrics = await workerRequest("/api/public/metrics", {}, env);
    expect(publicMetrics.headers.get("Cache-Control")).toBeNull();
  });

  it("enforces one shared side-effect limit per connection", async () => {
    const limitedEnv = Object.create(env) as Env;
    limitedEnv.SIDE_EFFECT_RATE_LIMITER = memoryRateLimit(10);

    for (let index = 0; index < 10; index += 1) {
      await enforceSideEffectRateLimit(limitedEnv, "conn-a");
    }
    await expect(
      enforceSideEffectRateLimit(limitedEnv, "conn-a")
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    await expect(
      enforceSideEffectRateLimit(limitedEnv, "conn-b")
    ).resolves.toBeUndefined();
  });

  it("reports side-effect limits in Action and MCP error contracts", async () => {
    const limitedEnv = Object.create(env) as Env;
    limitedEnv.SIDE_EFFECT_RATE_LIMITER = memoryRateLimit(0);
    limitedEnv.AUTHENTICATED_CONNECTION_ID = "conn-limited";
    const input = {
      locationId: "loc-1",
      ruleJson: switchOnRuleJson()
    };

    const actionResponse = await app.request(
      "/action/rules/create",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      },
      limitedEnv
    );
    expect(actionResponse.status).toBe(429);
    expect(actionResponse.headers.get("Retry-After")).toBe("60");
    expect(await actionResponse.json()).toMatchObject({
      ok: false,
      code: "RATE_LIMITED"
    });

    delete limitedEnv.AUTHENTICATED_CONNECTION_ID;
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    const mcpResponse = await workerRequest(
      "/mcp",
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: toolNames.createRuleConfirmed,
            arguments: input
          }
        })
      },
      limitedEnv
    );
    expect(mcpResponse.status).toBe(200);
    expect(await mcpJsonRpcPayload(mcpResponse)).toMatchObject({
      result: {
        structuredContent: {
          ok: false,
          code: "RATE_LIMITED"
        },
        isError: true
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies before API, OAuth, Action, or MCP handling", async () => {
    expect(requestBodyLimit(new Request("http://localhost/api/smartthings/connect"))).toBe(
      REQUEST_BODY_LIMITS.smartThingsConnect
    );
    expect(requestBodyLimit(new Request("http://localhost/oauth/token"))).toBe(
      REQUEST_BODY_LIMITS.oauth
    );
    expect(requestBodyLimit(new Request("http://localhost/action/rules/create"))).toBe(
      REQUEST_BODY_LIMITS.action
    );
    expect(requestBodyLimit(new Request("http://localhost/mcp"))).toBe(
      REQUEST_BODY_LIMITS.mcp
    );

    const exactLimit = await workerRequest(
      "/api/session",
      {
        method: "POST",
        body: "x".repeat(REQUEST_BODY_LIMITS.fallback)
      },
      env
    );
    expect(exactLimit.status).toBe(200);

    const chunkedTooLarge = await workerRequest(
      "/api/session",
      {
        method: "POST",
        headers: { "Content-Length": "1" },
        body: bodyStream(REQUEST_BODY_LIMITS.fallback + 1)
      },
      env
    );
    expect(chunkedTooLarge.status).toBe(413);
    expect(await chunkedTooLarge.json()).toMatchObject({
      ok: false,
      code: "PAYLOAD_TOO_LARGE"
    });

    const declaredTooLarge = await workerRequest(
      "/api/session",
      {
        method: "POST",
        headers: {
          "Content-Length": String(REQUEST_BODY_LIMITS.fallback + 1)
        },
        body: "x"
      },
      env
    );
    expect(declaredTooLarge.status).toBe(413);

    const connectTooLarge = await workerRequest(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(REQUEST_BODY_LIMITS.smartThingsConnect + 1)
      },
      env
    );
    expect(connectTooLarge.status).toBe(413);

    const oauthTooLarge = await workerRequest(
      "/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "x".repeat(REQUEST_BODY_LIMITS.oauth + 1)
      },
      env
    );
    expect(oauthTooLarge.status).toBe(413);
    expect(await oauthTooLarge.json()).toMatchObject({ error: "invalid_request" });

    const actionTooLarge = await workerRequest(
      "/action/rules/create",
      {
        method: "POST",
        body: "x".repeat(REQUEST_BODY_LIMITS.action + 1)
      },
      env
    );
    expect(actionTooLarge.status).toBe(413);

    const mcpTooLarge = await workerRequest(
      "/mcp",
      {
        method: "POST",
        body: "x".repeat(REQUEST_BODY_LIMITS.mcp + 1)
      },
      env
    );
    expect(mcpTooLarge.status).toBe(413);
    expect(await mcpTooLarge.json()).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000 }
    });
  });

  it("validates SmartThings reads and stores PAT encrypted", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    const response = await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      connected: true,
      locationsCount: 1,
      devicesCount: 1,
      rulesCount: 1
    });

    const connectionId = connectionIdFromCookie(cookie);
    const stored = await env.CONNECTION_GATE
      .getByName(connectionId)
      .getPatEnvelope();
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(PAT);
    expect(Date.parse(stored?.expiresAt ?? "")).toBeGreaterThan(
      Date.now() + (PAT_TTL_SECONDS - 60) * 1000
    );
    expect(Date.parse(stored?.expiresAt ?? "")).toBeLessThanOrEqual(
      Date.now() + PAT_TTL_SECONDS * 1000
    );
    expect([...kv.values.keys()].some((key) => key.startsWith("pat:"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://smartthings.test/v1/locations",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${PAT}`
        })
      })
    );
  });

  it("physically clears expired PAT ciphertext when the ConnectionGate alarm runs", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const connectionId = connectionIdFromCookie(cookie);
    const gate = env.CONNECTION_GATE.getByName(connectionId);
    const envelope = await gate.getPatEnvelope();
    expect(envelope).not.toBeNull();
    const expiredSaved = await gate.savePat({
      ...envelope!,
      expiresAt: new Date(Date.now() - 1_000).toISOString()
    });

    const alarmAndExpiry = await runInDurableObject(
      gate,
      async (_instance, state) => ({
        alarm: await state.storage.getAlarm(),
        row: state.storage.sql
          .exec<{ active: number; pat_expires_at: number | null }>(
            "SELECT active, pat_expires_at FROM connection_state WHERE singleton = 1"
          )
          .one()
      })
    );
    expect(expiredSaved).toBe(true);
    expect(alarmAndExpiry.alarm).toEqual(expect.any(Number));
    expect(alarmAndExpiry.row.active).toBe(1);
    expect(await runDurableObjectAlarm(gate)).toBe(true);
    const storedCiphertext = await runInDurableObject(
      gate,
      (_instance, state) =>
        state.storage.sql
          .exec<{ pat_envelope: string | null }>(
            "SELECT pat_envelope FROM connection_state WHERE singleton = 1"
          )
          .one().pat_envelope
    );
    expect(storedCiphertext).toBeNull();
  });

  it("binds OAuth consent nonces to one request and consumes them once", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const gate = env.CONNECTION_GATE.getByName(connectionIdFromCookie(cookie));
    const now = Date.now();
    expect(
      await gate.createOAuthConsentNonce(
        "consent-wrong-request",
        "request-a",
        now + 60_000,
        now
      )
    ).toBe(true);
    expect(
      await gate.consumeOAuthConsentNonce(
        "consent-wrong-request",
        "request-b",
        now
      )
    ).toBe(false);

    expect(
      await gate.createOAuthConsentNonce(
        "consent-single-use",
        "request-a",
        now + 60_000,
        now
      )
    ).toBe(true);
    expect(
      await gate.consumeOAuthConsentNonce("consent-single-use", "request-a", now)
    ).toBe(true);
    expect(
      await gate.consumeOAuthConsentNonce("consent-single-use", "request-a", now)
    ).toBe(false);

    expect(
      await gate.createOAuthConsentNonce(
        "consent-expired",
        "request-a",
        now + 60_000,
        now
      )
    ).toBe(true);
    await runInDurableObject(gate, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE oauth_consent_nonces SET expires_at = ?",
        now - 1
      );
      await state.storage.setAlarm(now + 1_000);
    });
    expect(await runDurableObjectAlarm(gate)).toBe(true);
    const remaining = await runInDurableObject(
      gate,
      (_instance, state) =>
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM oauth_consent_nonces"
          )
          .one().count
    );
    expect(remaining).toBe(0);
  });

  it("enriches SmartThings devices with room names for the web API", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const response = await app.request(
      "/api/smartthings/devices?locationId=loc-1",
      {
        headers: {
          Cookie: cookie
        }
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      devices: [
        {
          deviceId: "dev-1",
          label: "거실등",
          roomId: "room-1",
          roomName: "거실"
        }
      ]
    });
  });

  it("follows SmartThings pagination when listing devices", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.pathname === "/v1/locations" && method === "GET") {
        return jsonResponse({
          items: [{ locationId: "loc-1", name: "Home" }]
        });
      }

      if (url.pathname === "/v1/devices" && method === "GET") {
        const locationId = url.searchParams.get("locationId");
        const page = url.searchParams.get("page");
        if (page === "2") {
          return jsonResponse({
            items: [
              {
                deviceId: "dev-2",
                label: "침실등",
                locationId: locationId ?? "loc-1",
                components: [
                  {
                    id: "main",
                    capabilities: [{ id: "switch", version: 1 }]
                  }
                ]
              }
            ]
          });
        }

        return jsonResponse({
          items: [
            {
              deviceId: "dev-1",
              label: "거실등",
              locationId: locationId ?? "loc-1",
              components: [
                {
                  id: "main",
                  capabilities: [{ id: "switch", version: 1 }]
                }
              ]
            }
          ],
          _links: {
            next: {
              href: `https://smartthings.test/v1/devices${locationId ? `?locationId=${locationId}&page=2` : "?page=2"}`
            }
          }
        });
      }

      if (url.pathname === "/v1/rules" && method === "GET") {
        return jsonResponse({ items: [] });
      }

      return jsonResponse({}, 404);
    });

    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const response = await app.request(
      "/api/smartthings/devices?locationId=loc-1",
      {
        headers: {
          Cookie: cookie
        }
      },
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      devices: Array<{ deviceId: string; label: string }>;
    };
    expect(body.devices).toEqual([
      expect.objectContaining({ deviceId: "dev-1", label: "거실등" }),
      expect.objectContaining({ deviceId: "dev-2", label: "침실등" })
    ]);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        input.toString() === "https://smartthings.test/v1/devices?locationId=loc-1&page=2"
      )
    ).toBe(true);
  });

  it.each([
    "https://outside.example/v1/devices?page=2",
    "http://smartthings.test/v1/devices?page=2",
    "https://smartthings.test/v2/devices?page=2",
    "https://smartthings.test/v1/rules?page=2",
    "https://smartthings.test/rules?page=2"
  ])("rejects pagination links outside the configured SmartThings API boundary: %s", async (href) => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [], _links: { next: { href } } })
    );

    await expect(new SmartThingsClient(env, PAT).listDevices()).rejects.toMatchObject({
      code: "SMARTTHINGS_API_ERROR",
      status: 502
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes versionless SmartThings pagination links to the configured v1 collection", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ deviceId: "dev-1", label: "첫 번째 기기" }],
          _links: {
            next: {
              href: "https://smartthings.test/devices?max=1&page=1&isNext=true"
            }
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ deviceId: "dev-2", label: "두 번째 기기" }] })
      );

    const devices = await new SmartThingsClient(env, PAT).listDevices();

    expect(devices.map((device) => device.deviceId)).toEqual(["dev-1", "dev-2"]);
    expect(fetchMock.mock.calls[1]?.[0].toString()).toBe(
      "https://smartthings.test/v1/devices?max=1&page=1&isNext=true"
    );
  });

  it("stops unique pagination sequences at the page limit", async () => {
    let page = 0;
    fetchMock.mockImplementation(async () => {
      page += 1;
      return jsonResponse({
        items: [],
        _links: {
          next: {
            href: `https://smartthings.test/v1/devices?page=${page}`
          }
        }
      });
    });

    await expect(new SmartThingsClient(env, PAT).listDevices()).rejects.toMatchObject({
      code: "SMARTTHINGS_API_ERROR",
      status: 502
    });
    expect(fetchMock).toHaveBeenCalledTimes(100);
  });

  it("rejects oversized SmartThings collections and response bodies", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: Array.from({ length: 10_001 }, () => ({})) })
    );
    await expect(new SmartThingsClient(env, PAT).listDevices()).rejects.toMatchObject({
      code: "SMARTTHINGS_API_ERROR",
      status: 502
    });

    fetchMock.mockResolvedValueOnce(
      new Response("x".repeat(2 * 1024 * 1024 + 1), {
        headers: { "Content-Type": "application/json" }
      })
    );
    await expect(new SmartThingsClient(env, PAT).listLocations()).rejects.toMatchObject({
      code: "SMARTTHINGS_API_ERROR",
      status: 502
    });
  });

  it("returns a fixed reconnect error when PAT is missing", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    const response = await app.request(
      "/api/smartthings/devices",
      {
        headers: {
          Cookie: cookie
        }
      },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "SMARTTHINGS_PAT_EXPIRED",
      reconnectUrl: expect.stringMatching(
        /^http:\/\/localhost\/connect#reconnect=rt_/u
      )
    });
  });

  it("deletes stored PATs without resetting the browser connection", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const connectionId = connectionIdFromCookie(cookie);
    expect(
      await env.CONNECTION_GATE.getByName(connectionId).getPatEnvelope()
    ).not.toBeNull();

    const response = await app.request(
      "/api/smartthings/token",
      {
        method: "DELETE",
        headers: {
          Cookie: cookie
        }
      },
      env
    );

    expect(response.status).toBe(200);
    expect(
      await env.CONNECTION_GATE.getByName(connectionId).getPatEnvelope()
    ).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("does not echo PAT when SmartThings rejects a connect request", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "bad token" }, 403));

    const response = await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toContain("SMARTTHINGS_PERMISSION_DENIED");
    expect(text).not.toContain(PAT);
  });

  it("reports a clear configuration error when the encryption key is missing", async () => {
    const response = await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      {
        ...env,
        ST_TOKEN_ENC_KEY: undefined
      }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "CONFIGURATION_ERROR",
      messageForUser: "서버 암호화 키가 설정되지 않았습니다."
    });
  });

  it("serves the GPT Actions OpenAPI schema", async () => {
    const response = await app.request("/action/openapi.json", {}, env);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      openapi: string;
      security: Array<Record<string, string[]>>;
      paths: Record<
        string,
        {
          get?: {
            operationId: string;
            description: string;
            parameters?: Array<Record<string, unknown>>;
          };
          post?: { operationId: string; description: string };
          put?: { operationId: string; description: string };
          delete?: { operationId: string; description: string };
        }
      >;
      components: {
        schemas: Record<string, unknown>;
      };
    };
    expect(body).toMatchObject({
      openapi: "3.1.0",
      info: {
        title: "SmartThings Rules Copilot Actions"
      }
    });
    expect(body.security).toEqual([{ OAuth2: ["smartthings:rules"] }]);
    expect(Object.keys(body.paths)).toEqual([
      "/status",
      "/locations",
      "/devices",
      "/capabilities/inspect-context",
      "/rules",
      "/rules/{ruleId}",
      "/rules/update",
      "/rules/delete",
      "/rules/set-status",
      "/rules/check-json-references",
      "/rules/create",
      "/rule-references",
      "/rule-references/{referenceId}"
    ]);
    expect(body.paths["/rules"].get?.operationId).toBe("listRules");
    expect(body.paths["/capabilities/inspect-context"].post?.operationId).toBe(
      "inspectCapabilityContext"
    );
    expect(body.paths["/rules/{ruleId}"].get?.operationId).toBe("getRuleDetail");
    expect(body.paths["/rules/update"].post?.operationId).toBe(
      "updateRuleConfirmed"
    );
    expect(body.paths["/rules/{ruleId}"].put).toBeUndefined();
    expect(body.paths["/rules/{ruleId}"].delete).toBeUndefined();
    expect(body.paths["/rules/delete"].post?.operationId).toBe(
      "deleteRuleConfirmed"
    );
    expect(body.paths["/rules/set-status"].post?.operationId).toBe(
      "setRuleStatusConfirmed"
    );
    expect(body.paths["/rules/check-json-references"].post?.operationId).toBe(
      "checkRuleJsonReferences"
    );
    expect(body.paths["/rules/create"].post?.operationId).toBe(
      "createRuleConfirmed"
    );
    expect(body.paths["/rule-references"].get?.operationId).toBe(
      "searchRuleReferences"
    );
    expect(body.paths["/rule-references/{referenceId}"].get?.operationId).toBe(
      "getRuleReference"
    );
    expect(body.paths["/devices"].get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "cursor",
          in: "query",
          required: false,
          schema: expect.objectContaining({
            type: "integer",
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER
          })
        })
      ])
    );
    const operationDescriptions = {
      getStatus: body.paths["/status"].get?.description,
      listLocations: body.paths["/locations"].get?.description,
      listDevices: body.paths["/devices"].get?.description,
      inspectCapabilityContext:
        body.paths["/capabilities/inspect-context"].post?.description,
      listRules: body.paths["/rules"].get?.description,
      getRuleDetail: body.paths["/rules/{ruleId}"].get?.description,
      updateRuleConfirmed: body.paths["/rules/update"].post?.description,
      deleteRuleConfirmed: body.paths["/rules/delete"].post?.description,
      setRuleStatusConfirmed: body.paths["/rules/set-status"].post?.description,
      checkRuleJsonReferences:
        body.paths["/rules/check-json-references"].post?.description,
      createRuleConfirmed: body.paths["/rules/create"].post?.description,
      searchRuleReferences: body.paths["/rule-references"].get?.description,
      getRuleReference:
        body.paths["/rule-references/{referenceId}"].get?.description
    };
    expect(operationDescriptions).toEqual(toolDescriptions);
    expect(body.components.schemas.Device).toMatchObject({
      required: ["deviceId", "label", "components"],
      properties: {
        deviceId: { type: "string" },
        label: { type: "string" },
        roomName: { type: "string" },
        components: {
          type: "array"
        }
      }
    });
    expect(JSON.stringify(body.components.schemas.Device)).not.toContain("\"roomId\"");
    expect(JSON.stringify(body.components.schemas.Device)).not.toContain("\"locationId\"");
    expect(JSON.stringify(body.components.schemas.Device)).not.toContain("\"name\"");
    expect(JSON.stringify(body.components.schemas.Device)).not.toContain("\"capabilities\":{");
    expect(body).toMatchObject({
      components: {
        securitySchemes: {
          OAuth2: {
            type: "oauth2",
            flows: {
              authorizationCode: {
                scopes: {
                  "smartthings:rules": expect.any(String)
                }
              }
            }
          }
        },
        schemas: {
          Device: {
            required: expect.arrayContaining(["components"]),
            properties: {
              components: {
                items: { $ref: "#/components/schemas/DeviceComponent" }
              }
            }
          },
          DeviceListStructuredContent: {
            required: ["ok", "devices", "totalCount", "hasMore"],
            properties: {
              nextCursor: expect.objectContaining({
                type: "integer",
                minimum: 0,
                maximum: Number.MAX_SAFE_INTEGER
              })
            }
          },
          RuleJsonReferenceCheckIssue: {
            required: expect.arrayContaining(["code", "message", "path"])
          },
          CapabilityContextInspectionInput: {
            required: ["locationId", "targets"]
          },
          CapabilityContextInspectionResponse: {
            required: ["content", "structuredContent"]
          },
          CapabilityContextInspectionStructuredContent: {
            required: ["ok", "contexts"]
          },
          CapabilityContext: {
            required: expect.arrayContaining([
              "deviceId",
              "componentId",
              "capabilityId",
              "normalized",
              "warnings"
            ])
          },
          RuleJsonReferenceCheckInput: {
            required: ["locationId", "ruleJson"]
          },
          RuleJsonReferenceCheckResponse: {
            required: ["content", "structuredContent"]
          },
          RuleJsonReferenceCheckStructuredContent: {
            required: ["ok", "referencesOk", "errors"]
          },
          CreateRuleConfirmedInput: {
            required: ["locationId", "ruleJson"]
          },
          CreateRuleExecutionResponse: {
            required: ["content", "structuredContent"]
          },
          UpdateRuleConfirmedInput: {
            required: ["locationId", "ruleId", "ruleJson"]
          },
          UpdateRuleExecutionResponse: {
            required: ["content", "structuredContent"]
          },
          DeleteRuleConfirmedInput: {
            required: ["locationId", "ruleId"]
          },
          DeleteRuleExecutionResponse: {
            required: ["content", "structuredContent"]
          },
          SetRuleStatusConfirmedInput: {
            required: ["locationId", "ruleId", "targetStatus"]
          },
          SetRuleStatusExecutionResponse: {
            required: ["content", "structuredContent"]
          },
          RuleWriteExecutionStructuredContent: {
            required: ["ok", "executionStatus", "request", "response", "readback"]
          },
          SmartThingsRuleJsonDraft: {
            required: ["name", "actions"]
          },
          ToolTextContent: {
            required: ["type", "text"]
          },
          ToolGuidance: {
            properties: {
              next: { $ref: "#/components/schemas/ToolNext" },
              elicitation: { $ref: "#/components/schemas/ElicitationHint" }
            }
          },
          ToolNext: {
            required: ["step", "reason"]
          },
          ElicitationHint: {
            required: ["message", "requestedSchema"]
          }
        }
      }
    });
    expect(JSON.stringify(body.components.schemas.DeviceComponent)).not.toContain(
      "capabilityVersions"
    );
    expect(body.components.schemas).not.toHaveProperty("FlowNext");
    expect(body.components.schemas).not.toHaveProperty("FlowAsk");
    expect(JSON.stringify(body.components.schemas.ToolNext)).toContain(
      '"get_rule_reference"'
    );
    expect(JSON.stringify(body.components.schemas.StatusResponse)).not.toContain("devicesCount");
    expect(JSON.stringify(body.components.schemas.StatusResponse)).not.toContain("rulesCount");
    expect(JSON.stringify(body)).not.toContain("\"hint\"");
    for (const schemaName of [
      "CreateRuleConfirmedInput",
      "UpdateRuleConfirmedInput",
      "DeleteRuleConfirmedInput",
      "SetRuleStatusConfirmedInput"
    ]) {
      const schemaText = JSON.stringify(body.components.schemas[schemaName]);
      expect(schemaText).not.toContain("explicitInChatConfirmation");
      expect(schemaText).not.toContain("reviewSummary");
      expect(schemaText).not.toContain("reviewWarnings");
    }
    expect(JSON.stringify(body.components.schemas.RuleJsonReferenceCheckInput)).not.toContain("summary");
    expect(JSON.stringify(body.components.schemas.RuleJsonReferenceCheckInput)).not.toContain("referenceIds");
    expect(JSON.stringify(body.components.schemas.RuleJsonReferenceCheckResponse)).not.toContain("summary");
    expect(JSON.stringify(body.components.schemas.RuleJsonReferenceCheckResponse)).not.toContain("messageForUser");
    expect(JSON.stringify(body.components.schemas.RuleJsonReferenceCheckResponse)).not.toContain("ruleJson");
    expect(JSON.stringify(body.components.schemas.RuleJsonReferenceCheckResponse)).not.toContain("validation");
    expect(JSON.stringify(body)).not.toContain("proposeRule");
    expect(JSON.stringify(body)).not.toContain("validateProposal");
    expect(JSON.stringify(body)).not.toContain("validateRuleJson");
  });

  it("keeps shared AI instructions concise and aligned with the public contract", () => {
    expect(gptBuilderInstructions).toContain("Use the available Actions");
    expect(mcpServerInstructions).toContain("Use the available tools");
    for (const instructions of [gptBuilderInstructions, mcpServerInstructions]) {
      expect(instructions).toContain(
        "Strongly prefer searchRuleReferences followed by getRuleReference"
      );
      expect(instructions).toContain(
        "Simple unambiguous patterns such as switch on/off or contactSensor open/closed may skip them."
      );
      expect(instructions).toContain(
        "report executionStatus, request, response, and readback"
      );
      expect(instructions).toContain("readback.confirmed is true");
    }

    const allInstructionText = [
      gptBuilderInstructions,
      mcpServerInstructions,
      ...Object.values(toolDescriptions)
    ].join("\n");
    for (const staleTerm of [
      "explicitInChatConfirmation",
      "reviewSummary",
      "reviewWarnings",
      "requestJson",
      "smartThingsResponse",
      "readbackResult",
      "web final confirmation"
    ]) {
      expect(allInstructionText).not.toContain(staleTerm);
    }

    for (const instruction of Object.values(toolInstructions)) {
      expect(instruction.description.length).toBeLessThanOrEqual(300);
    }
  });

  it("requires authentication from GPT Actions status without a session", async () => {
    const response = await app.request("/action/status", {}, env);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "SMARTTHINGS_PAT_EXPIRED",
      reconnectUrl: "http://localhost/connect"
    });
  });

  it("returns a reconnect error from GPT Actions status with a session but no PAT", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    const response = await app.request(
      "/action/status",
      { headers: { Cookie: cookie } },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "SMARTTHINGS_PAT_EXPIRED",
      reconnectUrl: expect.stringMatching(
        /^http:\/\/localhost\/connect#reconnect=rt_/u
      )
    });
  });

  it("returns minimal connected status and directs GPT Actions to list locations", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const response = await app.request(
      "/action/status",
      { headers: { Cookie: cookie } },
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      content: [{ type: "text", text: expect.any(String) }],
      structuredContent: {
        ok: true,
        connected: true,
        locationsCount: 1,
        guidance: {
          next: {
            step: "list_locations",
            tool: "listLocations"
          }
        }
      }
    });
    expect(body).not.toHaveProperty("locations");
    expect(body).not.toHaveProperty("devices");
    expect(body).not.toHaveProperty("rules");
    expect(body).not.toHaveProperty("devicesCount");
    expect(body).not.toHaveProperty("rulesCount");
    expect(body).not.toHaveProperty("messageForUser");
    expect(body).not.toHaveProperty("messageForModel");
    expect(body).not.toHaveProperty("next");
    expect(body).not.toHaveProperty("ask");
    const structuredContent = body.structuredContent as Record<string, unknown>;
    expect(structuredContent).not.toHaveProperty("locations");
    expect(structuredContent).not.toHaveProperty("devices");
    expect(structuredContent).not.toHaveProperty("rules");
    expect(structuredContent).not.toHaveProperty("devicesCount");
    expect(structuredContent).not.toHaveProperty("rulesCount");
    expect(hasSmartThingsDeviceListCall(fetchMock)).toBe(false);
    expect(hasSmartThingsRuleListCall(fetchMock)).toBe(false);
  });

  it("serves rule reference search without SmartThings credentials", async () => {
    const response = await app.request(
      "/api/rule-references?triggerCapabilities=contactSensor&actionCapabilities=switch&constructs=if,command&limit=3",
      {},
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      references: Array<{
        id: string;
        patternKind: string;
        aliases: string[];
        sourceExamplePath: string;
        score: number;
        matchedFields: string[];
        example?: unknown;
      }>;
    };
    expect(body.references.length).toBeGreaterThan(0);
    expect(body.references[0]).toMatchObject({
      id: "contact-opens-switch-on",
      patternKind: "derived",
      sourceName: "Project-authored template (SmartThings Rules grammar)",
      sourceExamplePath: "Rules guide / Conditions / equals + Actions / command"
    });
    expect(body.references[0].aliases).toContain("문이 열리면");
    expect(body.references[0].score).toBeGreaterThan(0);
    expect(body.references[0].matchedFields).toContain(
      "triggerCapabilities:contactsensor"
    );
    expect(body.references[0].example).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("matches Korean natural-language reference queries", async () => {
    const response = await app.request(
      "/api/rule-references?query=%EB%AA%A8%EC%85%98%20%EA%B0%90%EC%A7%80%ED%95%98%EB%A9%B4%20%EB%B6%88%20%EC%BC%9C%EA%B8%B0&limit=3",
      {},
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      references: Array<{
        id: string;
        matchedFields: string[];
      }>;
    };
    expect(body.references[0].id).toBe("motion-active-switch-on");
    expect(
      body.references[0].matchedFields.some((field) =>
        field.startsWith("query:")
      )
    ).toBe(true);
  });

  it("matches changes condition reference filters", async () => {
    const response = await app.request(
      "/api/rule-references?conditions=changes&operands=device,integer&limit=3",
      {},
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      references: Array<{
        id: string;
        patternKind: string;
        conditions: string[];
        operands: string[];
        matchedFields: string[];
      }>;
    };
    expect(body.references[0]).toMatchObject({
      id: "switch-level-changes-less-than",
      patternKind: "derived",
      conditions: expect.arrayContaining(["changes", "lessThan"]),
      operands: expect.arrayContaining(["device", "integer"])
    });
    expect(body.references[0].matchedFields).toContain("conditions:changes");
  });

  it("matches changes with precondition examples and keeps trigger Never on the gate only", async () => {
    const params = new URLSearchParams({
      query: "changes with state gate",
      conditions: "changes",
      operands: "trigger",
      limit: "3"
    });
    const search = await app.request(
      `/api/rule-references?${params.toString()}`,
      {},
      env
    );

    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as {
      references: Array<{
        id: string;
        conditions: string[];
        operands: string[];
        matchedFields: string[];
      }>;
    };
    expect(searchBody.references[0]).toMatchObject({
      id: "switch-level-changes-less-than-with-switch-precondition",
      conditions: expect.arrayContaining(["and", "changes", "lessThan", "equals"]),
      operands: expect.arrayContaining(["trigger"])
    });
    expect(searchBody.references[0].matchedFields).toContain("conditions:changes");
    expect(searchBody.references[0].matchedFields).toContain("operands:trigger");

    const detail = await app.request(
      "/api/rule-references/switch-level-changes-less-than-with-switch-precondition",
      {},
      env
    );

    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      reference: {
        mappingNotes: string[];
        example: {
          actions: Array<{
            if: {
              and: [
                {
                  changes: {
                    lessThan: {
                      left: { device: Record<string, unknown> };
                    };
                  };
                },
                {
                  equals: {
                    left: { device: Record<string, unknown> };
                  };
                }
              ];
            };
          }>;
        };
      };
    };
    const changesDevice =
      detailBody.reference.example.actions[0].if.and[0].changes.lessThan.left.device;
    const gateDevice =
      detailBody.reference.example.actions[0].if.and[1].equals.left.device;

    expect(detailBody.reference.mappingNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("trigger=\"Never\"를 붙이지 않는다"),
        expect.stringContaining("gate 역할의 상태 조건")
      ])
    );
    expect(changesDevice).not.toHaveProperty("trigger");
    expect(gateDevice).toMatchObject({ trigger: "Never" });
  });

  it("matches threshold comparison wording across plain, remains, and changes examples", async () => {
    const filterResponse = await app.request(
      "/api/rule-references?conditions=lessThan&operands=trigger&query=humidity%20threshold&limit=3",
      {},
      env
    );

    expect(filterResponse.status).toBe(200);
    const filterBody = (await filterResponse.json()) as {
      references: Array<{
        id: string;
        conditions: string[];
        operands: string[];
        matchedFields: string[];
      }>;
    };
    expect(filterBody.references[0]).toMatchObject({
      id: "humidity-less-than-with-switch-precondition",
      conditions: expect.arrayContaining(["lessThan", "equals"]),
      operands: expect.arrayContaining(["trigger"])
    });
    expect(filterBody.references[0].matchedFields).toContain("conditions:lessthan");
    expect(filterBody.references[0].matchedFields).toContain("operands:trigger");

    const plainCases = [
      "습도가 35 이하면 가습기 켜기",
      "습도가 35 미만이면 가습기 켜기",
      "습도가 기준 이상이면 가습기 켜기",
      "습도가 기준 초과면 가습기 켜기"
    ];

    for (const query of plainCases) {
      const params = new URLSearchParams({ query, limit: "3" });
      const response = await app.request(
        `/api/rule-references?${params.toString()}`,
        {},
        env
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        references: Array<{ id: string; matchedFields: string[] }>;
      };
      expect(body.references[0]?.id).toBe(
        "humidity-less-than-with-switch-precondition"
      );
      expect(
        body.references[0]?.matchedFields.some((field) =>
          field.startsWith("query:")
        )
      ).toBe(true);
    }

    const remainsParams = new URLSearchParams({
      query: "기준 이하로 유지되면",
      conditions: "remains",
      limit: "3"
    });
    const remainsResponse = await app.request(
      `/api/rule-references?${remainsParams.toString()}`,
      {},
      env
    );
    expect(remainsResponse.status).toBe(200);
    const remainsBody = (await remainsResponse.json()) as {
      references: Array<{ id: string; conditions: string[]; matchedFields: string[] }>;
    };
    expect(remainsBody.references[0]).toMatchObject({
      id: "switch-level-remains-less-than",
      conditions: expect.arrayContaining(["remains", "lessThan"])
    });
    expect(remainsBody.references[0].matchedFields).toContain("conditions:remains");

    const changesParams = new URLSearchParams({
      query: "기준 초과로 바뀌면",
      conditions: "changes",
      limit: "3"
    });
    const changesResponse = await app.request(
      `/api/rule-references?${changesParams.toString()}`,
      {},
      env
    );
    expect(changesResponse.status).toBe(200);
    const changesBody = (await changesResponse.json()) as {
      references: Array<{ id: string; conditions: string[]; matchedFields: string[] }>;
    };
    expect(changesBody.references[0]).toMatchObject({
      id: "switch-level-changes-less-than",
      conditions: expect.arrayContaining(["changes", "lessThan"])
    });
    expect(changesBody.references[0].matchedFields).toContain("conditions:changes");
  });

  it("matches specific datetime reference filters", async () => {
    const response = await app.request(
      "/api/rule-references?constructs=every&operands=specific&limit=3",
      {},
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      references: Array<{
        id: string;
        operands: string[];
        matchedFields: string[];
      }>;
    };
    expect(body.references[0]).toMatchObject({
      id: "schedule-switch-off",
      operands: expect.arrayContaining(["specific"])
    });
    expect(body.references[0].matchedFields).toContain("operands:specific");
  });

  it("matches natural-language specific time queries", async () => {
    const cases: Array<[string, string]> = [
      ["특정 시간에 조명 꺼줘", "schedule-switch-off"],
      ["7시에 조명 꺼줘", "schedule-switch-off"],
      ["turn off light at a specific time", "schedule-switch-off"],
      ["turn off lights at 7 pm", "schedule-switch-off"]
    ];

    for (const [query, expectedId] of cases) {
      const params = new URLSearchParams({ query, limit: "3" });
      const response = await app.request(
        `/api/rule-references?${params.toString()}`,
        {},
        env
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        references: Array<{ id: string; matchedFields: string[] }>;
      };
      expect(body.references[0]?.id).toBe(expectedId);
      expect(
        body.references[0]?.matchedFields.some((field) =>
          field.startsWith("query:")
        )
      ).toBe(true);
    }
  });

  it("matches Korean precondition reference queries", async () => {
    const response = await app.request(
      "/api/rule-references?query=%EC%84%A0%ED%96%89%EC%A1%B0%EA%B1%B4&limit=3",
      {},
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      references: Array<{
        id: string;
        patternKind: string;
        aliases: string[];
        operands: string[];
        matchedFields: string[];
      }>;
    };
    expect(body.references[0]).toMatchObject({
      id: "button-press-with-switch-precondition",
      patternKind: "derived",
      aliases: expect.arrayContaining(["선행조건"]),
      operands: expect.arrayContaining(["trigger"])
    });
    expect(
      body.references[0].matchedFields.some((field) =>
        field.startsWith("query:")
      )
    ).toBe(true);
  });

  it("matches Korean changes wording variants", async () => {
    const params = new URLSearchParams({
      query: "변할 때",
      limit: "3"
    });
    const response = await app.request(
      `/api/rule-references?${params.toString()}`,
      {},
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      references: Array<{ id: string; matchedFields: string[] }>;
    };
    expect(body.references[0].id).toBe("switch-level-changes-less-than");
    expect(
      body.references[0].matchedFields.some((field) =>
        field.startsWith("query:")
      )
    ).toBe(true);
  });

  it("distinguishes Korean sleep action and remains duration queries", async () => {
    const sleepCases = [
      "켜고 5분 뒤 꺼줘",
      "켜고 5분 후 꺼줘",
      "켜고 기다렸다 꺼줘"
    ];
    for (const query of sleepCases) {
      const params = new URLSearchParams({ query, limit: "3" });
      const response = await app.request(
        `/api/rule-references?${params.toString()}`,
        {},
        env
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        references: Array<{ id: string; matchedFields: string[] }>;
      };
      expect(body.references[0]?.id).toBe("switch-on-sleep-switch-off");
      expect(
        body.references[0]?.matchedFields.some((field) =>
          field.startsWith("query:")
        )
      ).toBe(true);
    }

    const remainsCases = [
      "5분 동안 움직임 없으면 꺼줘",
      "움직임이 계속 없으면 꺼줘",
      "모션이 일정 시간 없으면 꺼줘"
    ];
    for (const query of remainsCases) {
      const params = new URLSearchParams({ query, limit: "3" });
      const response = await app.request(
        `/api/rule-references?${params.toString()}`,
        {},
        env
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        references: Array<{ id: string; matchedFields: string[] }>;
      };
      expect(body.references[0]?.id).toBe("motion-inactive-remains-switch-off");
      expect(
        body.references[0]?.matchedFields.some((field) =>
          field.startsWith("query:")
        )
      ).toBe(true);
    }
  });

  it("matches English natural-language reference queries across templates", async () => {
    const cases: Array<[string, string]> = [
      ["turn the lights on when door opens", "contact-opens-switch-on"],
      ["turn on lights when motion is detected", "motion-active-switch-on"],
      ["turn off after no motion for five minutes", "motion-inactive-remains-switch-off"],
      ["turn on lights at sunset", "sunset-switch-on"],
      ["button pressed while switch is on", "button-press-with-switch-precondition"],
      ["level drops below threshold", "switch-level-changes-less-than"],
      ["turn the light red", "color-control-set-color"]
    ];

    for (const [query, expectedId] of cases) {
      const params = new URLSearchParams({ query, limit: "3" });
      const response = await app.request(
        `/api/rule-references?${params.toString()}`,
        {},
        env
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        references: Array<{ id: string; matchedFields: string[] }>;
      };
      expect(body.references[0]?.id).toBe(expectedId);
      expect(
        body.references[0]?.matchedFields.some((field) =>
          field.startsWith("query:")
        )
      ).toBe(true);
    }
  });

  it("returns one rule reference detail with placeholder JSON", async () => {
    const response = await app.request(
      "/api/rule-references/contact-opens-switch-on",
      {},
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      reference: {
        id: "contact-opens-switch-on",
        patternKind: "derived",
        sourceName: "Project-authored template (SmartThings Rules grammar)",
        sourceExamplePath: "Rules guide / Conditions / equals + Actions / command",
        mappingNotes: expect.arrayContaining([
          expect.stringContaining("contactSensor")
        ]),
        example: {
          actions: [
            {
              if: {
                equals: {
                  left: {
                    device: {
                      devices: ["<contactSensorDeviceId>"]
                    }
                  }
                }
              }
            }
          ]
        }
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns humidity threshold comparison detail with trigger precondition", async () => {
    const response = await app.request(
      "/api/rule-references/humidity-less-than-with-switch-precondition",
      {},
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      reference: {
        id: "humidity-less-than-with-switch-precondition",
        conditions: expect.arrayContaining(["and", "lessThan", "equals"]),
        operands: expect.arrayContaining(["trigger"]),
        mappingNotes: expect.arrayContaining([
          expect.stringContaining("plain comparison 대표 예시"),
          expect.stringContaining("이하/이상/미만/초과"),
          expect.stringContaining("trigger=\"Always\""),
          expect.stringContaining("trigger=\"Never\"")
        ]),
        example: {
          actions: [
            {
              if: {
                and: [
                  {
                    lessThan: {
                      left: {
                        device: {
                          capability: "relativeHumidityMeasurement",
                          trigger: "Always"
                        }
                      }
                    }
                  },
                  {
                    equals: {
                      left: {
                        device: {
                          capability: "switch",
                          trigger: "Never"
                        }
                      },
                      right: { string: "off" }
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns distinction mapping notes for easy-to-confuse rule references", async () => {
    const cases: Array<[
      string,
      Array<ReturnType<typeof expect.stringContaining>>
    ]> = [
      [
        "motion-inactive-remains-switch-off",
        [
          expect.stringContaining("inactive로 바뀌는 순간은 changes"),
          expect.stringContaining("sleep action 예시")
        ]
      ],
      [
        "switch-on-sleep-switch-off",
        [
          expect.stringContaining("조건이 아니라 이미 실행 중인 action sequence"),
          expect.stringContaining("remains 조건 예시")
        ]
      ],
      [
        "button-press-with-switch-precondition",
        [
          expect.stringContaining("A 상태일 때 B 이벤트가 발생하면"),
          expect.stringContaining("실행 시작 이벤트가 명확하지 않으면")
        ]
      ],
      [
        "switch-level-changes-less-than",
        [
          expect.stringContaining("false에서 true로 바뀌는 순간"),
          expect.stringContaining("remains 예시")
        ]
      ]
    ];

    for (const [referenceId, expectedNotes] of cases) {
      const response = await app.request(
        `/api/rule-references/${referenceId}`,
        {},
        env
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        reference: {
          id: referenceId,
          mappingNotes: expect.arrayContaining(expectedNotes)
        }
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown rule reference", async () => {
    const response = await app.request("/api/rule-references/not-real", {}, env);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "NOT_FOUND"
    });
  });

  it("serves GPT Actions rule reference endpoints without OAuth", async () => {
    const search = await app.request(
      "/action/rule-references?query=garage&limit=2",
      {},
      env
    );
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as {
      structuredContent: {
        guidance: { instructions: string[]; next: { step: string } };
        references: Array<{ id: string; matchReason: string }>;
      };
    };
    expect(searchBody).toMatchObject({
      structuredContent: {
        guidance: {
          next: {
            step: "get_rule_reference",
            tool: "getRuleReference"
          }
        }
      }
    });
    expect(searchBody.structuredContent.guidance.instructions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("getRuleReference"),
        expect.stringContaining("mappingNotes")
      ])
    );
    expect(
      searchBody.structuredContent.references.some((reference) =>
        reference.id.includes("garage")
      )
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    const detail = await app.request(
      `/action/rule-references/${searchBody.structuredContent.references[0].id}`,
      {},
      env
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      structuredContent: {
        ok: true,
        guidance: {
          next: {
            step: "draft_rule_json"
          }
        },
        reference: {
          id: searchBody.structuredContent.references[0].id,
          example: expect.any(Object)
        }
      }
    });
  });

  it("serves GPT Actions read-only endpoints through the shared service", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const locations = await app.request(
      "/action/locations",
      { headers: { Cookie: cookie } },
      env
    );
    expect(locations.status).toBe(200);
    expect(await locations.json()).toMatchObject({
      structuredContent: {
        ok: true,
        locations: [{ locationId: "loc-1", name: "Home" }],
        guidance: {
          next: {
            step: "list_devices",
            tool: "listDevices",
            arguments: { locationId: "loc-1" }
          }
        }
      }
    });

    const devices = await app.request(
      "/action/devices?locationId=loc-1",
      { headers: { Cookie: cookie } },
      env
    );
    expect(devices.status).toBe(200);
    const devicesBody = (await devices.json()) as {
      structuredContent: {
        devices: Record<string, unknown>[];
      };
    };
    expect(devicesBody).toMatchObject({
      structuredContent: {
        ok: true,
        guidance: {
          next: {
            step: "confirm_rule_targets"
          }
        },
        totalCount: 1,
        hasMore: false,
        devices: [
          {
            deviceId: "dev-1",
            label: "거실등",
            roomName: "거실",
            components: [
              {
                componentId: "main",
                capabilities: expect.arrayContaining(["switch", "switchLevel"])
              }
            ]
          }
        ]
      }
    });
    const returnedDevice = devicesBody.structuredContent.devices[0];
    expect(returnedDevice).not.toHaveProperty("name");
    expect(returnedDevice).not.toHaveProperty("locationId");
    expect(returnedDevice).not.toHaveProperty("roomId");
    expect(returnedDevice).not.toHaveProperty("capabilities");
    expect(JSON.stringify(returnedDevice)).not.toContain("capabilityVersions");

    const invalidDeviceCursor = await app.request(
      "/action/devices?locationId=loc-1&cursor=-1",
      { headers: { Cookie: cookie } },
      env
    );
    expect(invalidDeviceCursor.status).toBe(400);

    const rules = await app.request(
      "/action/rules?locationId=loc-1",
      { headers: { Cookie: cookie } },
      env
    );
    expect(rules.status).toBe(200);
    expect(await rules.json()).toMatchObject({
      structuredContent: {
        ok: true,
        guidance: {
          instructions: expect.arrayContaining([expect.stringContaining("context")])
        },
        rules: [{ id: "rule-1", name: "밤 11시 거실등 끄기", locationId: "loc-1" }]
      }
    });

    const ruleDetail = await app.request(
      "/action/rules/rule-1?locationId=loc-1",
      { headers: { Cookie: cookie } },
      env
    );
    expect(ruleDetail.status).toBe(200);
    expect(await ruleDetail.json()).toMatchObject({
      structuredContent: {
        ok: true,
        guidance: {
          instructions: expect.arrayContaining([expect.stringContaining("read-only")])
        },
        rule: {
          id: "rule-1",
          name: "밤 11시 거실등 끄기",
          locationId: "loc-1",
          actions: expect.any(Array)
        }
      }
    });
  });

  it("inspects capability context without calling presentation or write APIs by default", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const response = await app.request(
      "/action/capabilities/inspect-context",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          targets: [
            {
              deviceId: "dev-1",
              componentId: "main",
              capabilityId: "switch"
            },
            {
              deviceId: "dev-1",
              componentId: "main",
              capabilityId: "switchLevel"
            },
            {
              deviceId: "dev-1",
              componentId: "main",
              capabilityId: "contactSensor"
            },
            {
              deviceId: "dev-1",
              componentId: "main",
              capabilityId: "airConditionerMode"
            }
          ]
        })
      },
      env
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("Capability context") }],
      structuredContent: {
        ok: true,
        guidance: {
          next: {
            step: "search_rule_references",
            tool: "searchRuleReferences"
          }
        },
        contexts: [
          {
            deviceId: "dev-1",
            deviceLabel: "거실등",
            componentId: "main",
            capabilityId: "switch",
            capabilityVersion: 1,
            presentation: null,
            warnings: [],
            normalized: {
              attributeValueSchemas: [
                expect.objectContaining({
                  attribute: "switch",
                  enumCommands: ["on", "off"],
                  sourcePath: "$.definition.attributes.switch"
                })
              ],
              statusValues: [
                expect.objectContaining({
                  attribute: "switch",
                  kind: "scalar",
                  value: "off"
                })
              ]
            }
          },
          {
            capabilityId: "switchLevel",
            normalized: {
              commandArgumentSchemas: [
                expect.objectContaining({
                  command: "setLevel",
                  arguments: [
                    expect.objectContaining({
                      name: "level",
                      optional: false,
                      schema: expect.objectContaining({
                        minimum: 0,
                        maximum: 100
                      })
                    })
                  ]
                })
              ],
              statusValues: [
                expect.objectContaining({
                  attribute: "level",
                  kind: "scalar",
                  value: 50
                })
              ]
            }
          },
          {
            capabilityId: "contactSensor",
            normalized: {
              statusValues: [
                expect.objectContaining({
                  attribute: "contact",
                  value: "closed"
                })
              ]
            }
          },
          {
            capabilityId: "airConditionerMode",
            normalized: {
              statusValues: expect.arrayContaining([
                expect.objectContaining({
                  attribute: "supportedAcModes",
                  kind: "array",
                  value: ["aIComfort", "cool", "dry", "wind"]
                }),
                expect.objectContaining({
                  attribute: "airConditionerMode",
                  value: "aIComfort"
                })
              ])
            }
          }
        ]
      }
    });
    expect(hasCapabilityPresentationCall(fetchMock)).toBe(false);
    expect(hasSmartThingsWriteCall(fetchMock)).toBe(false);
  });

  it("includes automation presentation refs only when requested", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const response = await app.request(
      "/action/capabilities/inspect-context",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          targets: [
            {
              deviceId: "dev-1",
              componentId: "main",
              capabilityId: "airConditionerMode"
            }
          ],
          include: { presentation: true }
        })
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      structuredContent: {
        ok: true,
        contexts: [
          {
            presentation: {
              id: "airConditionerMode",
              version: 1,
              automation: {
                actions: expect.any(Array),
                conditions: []
              }
            },
            normalized: {
              presentationRefs: [
                {
                  surface: "automation.actions",
                  label: "온도조절 모드",
                  displayType: "list",
                  command: "setAirConditionerMode",
                  value: null,
                  supportedValues: "supportedAcModes.value",
                  alternatives: [{ key: "cool", value: "냉방" }],
                  sourcePath: "$.presentation.automation.actions[0]"
                }
              ]
            }
          }
        ]
      }
    });
  });

  it("reports target reference errors before capability fan-out", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const response = await app.request(
      "/action/capabilities/inspect-context",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          targets: [
            {
              deviceId: "dev-1",
              componentId: "icemaker",
              capabilityId: "switch"
            }
          ]
        })
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      structuredContent: {
        ok: true,
        contexts: [
          {
            deviceId: "dev-1",
            componentId: "icemaker",
            capabilityId: "switch",
            definition: null,
            deviceStatus: null,
            warnings: [
              expect.objectContaining({
                code: "DEVICE_COMPONENT_MISSING",
                path: "$.targets[0].componentId"
              })
            ]
          }
        ]
      }
    });
    expect(hasCapabilityDefinitionCall(fetchMock)).toBe(false);
    expect(hasCapabilityStatusCall(fetchMock)).toBe(false);
  });

  it("returns partial capability context when definition lookup fails", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());

      if (url.pathname === "/v1/locations") {
        return jsonResponse({
          items: [{ locationId: "loc-1", name: "Home" }]
        });
      }

      if (url.pathname === "/v1/devices") {
        return jsonResponse({
          items: [
            {
              deviceId: "dev-1",
              label: "커스텀 기기",
              components: [
                {
                  id: "main",
                  capabilities: [{ id: "custom.someCapability", version: 1 }]
                }
              ]
            }
          ]
        });
      }

      if (url.pathname === "/v1/rules") {
        return jsonResponse({ items: [] });
      }

      if (url.pathname === "/v1/capabilities/custom.someCapability/1") {
        return jsonResponse({ error: "not found" }, 404);
      }

      if (
        url.pathname ===
        "/v1/devices/dev-1/components/main/capabilities/custom.someCapability/status"
      ) {
        return jsonResponse({
          customStatus: {
            value: { mode: "vendorOnly" },
            timestamp: "2026-06-22T02:00:00.000Z"
          }
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    });

    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const response = await app.request(
      "/action/capabilities/inspect-context",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          targets: [
            {
              deviceId: "dev-1",
              componentId: "main",
              capabilityId: "custom.someCapability"
            }
          ]
        })
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      structuredContent: {
        ok: true,
        contexts: [
          {
            definition: null,
            deviceStatus: {
              customStatus: {
                value: { mode: "vendorOnly" }
              }
            },
            normalized: {
              statusValues: [
                expect.objectContaining({
                  attribute: "customStatus",
                  kind: "object",
                  value: { mode: "vendorOnly" }
                })
              ]
            },
            warnings: [
              expect.objectContaining({
                code: "CAPABILITY_DEFINITION_UNAVAILABLE"
              })
            ]
          }
        ]
      }
    });
  });

  it("requires PAT and rejects unsupported full presentation mode for capability context", async () => {
    const missingPat = await app.request(
      "/action/capabilities/inspect-context",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: "loc-1",
          targets: [
            {
              deviceId: "dev-1",
              componentId: "main",
              capabilityId: "switch"
            }
          ]
        })
      },
      env
    );
    expect(missingPat.status).toBe(401);
    expect(await missingPat.json()).toMatchObject({
      ok: false,
      code: "SMARTTHINGS_PAT_EXPIRED"
    });

    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const unsupportedMode = await app.request(
      "/action/capabilities/inspect-context",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          targets: [
            {
              deviceId: "dev-1",
              componentId: "main",
              capabilityId: "switch"
            }
          ],
          presentationMode: "full"
        })
      },
      env
    );
    expect(unsupportedMode.status).toBe(400);
    expect(await unsupportedMode.json()).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST"
    });
  });

  it("returns SmartThings Rule details from the web API", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const response = await app.request(
      "/api/smartthings/rules/rule-1?locationId=loc-1",
      {
        headers: {
          Cookie: cookie
        }
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      rule: {
        id: "rule-1",
        name: "밤 11시 거실등 끄기",
        locationId: "loc-1",
        actions: expect.any(Array)
      }
    });
  });

  it("requires a location ID for Rule detail lookups", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    const response = await app.request(
      "/api/smartthings/rules/rule-1",
      {
        headers: {
          Cookie: cookie
        }
      },
      env
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST"
    });
  });

  it("asks the user to choose when GPT Actions sees multiple locations", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());

      if (url.pathname === "/v1/locations") {
        return jsonResponse({
          items: [
            { locationId: "loc-1", name: "Home" },
            { locationId: "loc-2", name: "Office" }
          ]
        });
      }

      if (url.pathname === "/v1/devices") {
        return jsonResponse({ items: [] });
      }

      if (url.pathname === "/v1/rules") {
        return jsonResponse({ items: [] });
      }

      return jsonResponse({ error: "not found" }, 404);
    });

    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const response = await app.request(
      "/action/locations",
      { headers: { Cookie: cookie } },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      structuredContent: {
        ok: true,
        guidance: {
          next: {
            step: "choose_location"
          },
          elicitation: {
            message: expect.stringContaining("위치"),
            requestedSchema: {
              type: "object",
              properties: {
                locationId: {
                  type: "string",
                  enum: ["loc-1", "loc-2"],
                  enumNames: ["Home", "Office"]
                }
              },
              required: ["locationId"]
            }
          }
        }
      }
    });
  });

  it("checks drafted Rule JSON references without calling SmartThings write APIs", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const response = await app.request(
      "/action/rules/check-json-references",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleJson: switchOnRuleJson()
        })
      },
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("참조") }],
      structuredContent: {
        ok: true,
        referencesOk: true,
        errors: [],
        guidance: {
          next: {
            step: "show_checked_draft"
          }
        }
      }
    });
    const structuredContent = body.structuredContent as Record<string, unknown>;
    expect(body).not.toHaveProperty("messageForUser");
    expect(body).not.toHaveProperty("messageForModel");
    expect(body).not.toHaveProperty("next");
    expect(body).not.toHaveProperty("ask");
    expect(body).not.toHaveProperty("proposalId");
    expect(body).not.toHaveProperty("confirmationAvailable");
    expect(body).not.toHaveProperty("webConfirmationUrl");
    expect(body).not.toHaveProperty("canvasInstruction");
    expect(body).not.toHaveProperty("artifactInstruction");
    expect(body).not.toHaveProperty("nextAction");
    expect(body).not.toHaveProperty("agentInstruction");
    expect(body).not.toHaveProperty("summary");
    expect(body).not.toHaveProperty("validation");
    expect(body).not.toHaveProperty("ruleJson");
    expect(structuredContent).not.toHaveProperty("messageForUser");
    expect(structuredContent).not.toHaveProperty("proposalId");
    expect(structuredContent).not.toHaveProperty("confirmationAvailable");
    expect(structuredContent).not.toHaveProperty("webConfirmationUrl");
    expect(structuredContent).not.toHaveProperty("canvasInstruction");
    expect(structuredContent).not.toHaveProperty("artifactInstruction");
    expect(structuredContent).not.toHaveProperty("nextAction");
    expect(structuredContent).not.toHaveProperty("agentInstruction");
    expect(structuredContent).not.toHaveProperty("summary");
    expect(structuredContent).not.toHaveProperty("validation");
    expect(structuredContent).not.toHaveProperty("ruleJson");
    expect(hasSmartThingsWriteCall(fetchMock)).toBe(false);
  });

  it("rejects reference checks until the model provides drafted Rule JSON", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const response = await app.request(
      "/action/rules/check-json-references",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleJson: {
            actions: []
          }
        })
      },
      env
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
      messageForUser: expect.stringContaining("name/actions")
    });
  });

  it("uses the same minimal body-only contract for all GPT Action writes", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const create = await app.request(
      "/action/rules/create",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleJson: copilotSwitchOnRuleJson()
        })
      },
      env
    );
    const createBody = (await create.json()) as Record<string, any>;
    expect(create.status).toBe(200);
    expect(createBody.structuredContent).toMatchObject({
      ok: true,
      executionStatus: "created",
      request: {
        method: "POST",
        path: "/rules",
        query: { locationId: "loc-1" },
        body: { name: "[Copilot] 거실등 켜기" }
      },
      response: { status: 201 },
      readback: { confirmed: true, status: 200 }
    });

    const updateRuleJson = {
      ...copilotSwitchOnRuleJson(),
      name: "[Copilot] 거실등 켜기 수정"
    };
    const update = await app.request(
      "/action/rules/update",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleId: "rule-1",
          ruleJson: updateRuleJson
        })
      },
      env
    );
    const updateBody = (await update.json()) as Record<string, any>;
    expect(update.status).toBe(200);
    expect(updateBody.structuredContent).toMatchObject({
      ok: true,
      executionStatus: "updated",
      before: { id: "rule-1" },
      request: { method: "PUT", path: "/rules/rule-1", body: updateRuleJson },
      response: { status: 200 },
      readback: { confirmed: true, status: 200 }
    });

    const status = await app.request(
      "/action/rules/set-status",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleId: "rule-1",
          targetStatus: "Disabled"
        })
      },
      env
    );
    const statusBody = (await status.json()) as Record<string, any>;
    expect(status.status).toBe(200);
    expect(statusBody.structuredContent).toMatchObject({
      ok: true,
      executionStatus: "disabled",
      request: {
        method: "PUT",
        path: "/rules/rule-1/status/disable",
        body: null
      },
      response: { status: 200 },
      readback: { confirmed: true, status: 200 }
    });

    const remove = await app.request(
      "/action/rules/delete",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: "loc-1", ruleId: "rule-1" })
      },
      env
    );
    const deleteBody = (await remove.json()) as Record<string, any>;
    expect(remove.status).toBe(200);
    expect(deleteBody.structuredContent).toMatchObject({
      ok: true,
      executionStatus: "deleted",
      request: { method: "DELETE", path: "/rules/rule-1", body: null },
      response: { status: 200 },
      readback: { confirmed: true, status: 404 }
    });

    for (const payload of [createBody, updateBody, statusBody, deleteBody]) {
      const result = payload.structuredContent;
      expect(result).toHaveProperty("request");
      expect(result).toHaveProperty("response");
      expect(result).toHaveProperty("readback");
      expect(result).not.toHaveProperty("requestJson");
      expect(result).not.toHaveProperty("smartThingsResponse");
      expect(result).not.toHaveProperty("readbackResult");
      expect(result).not.toHaveProperty("reviewSummary");
      expect(result).not.toHaveProperty("reviewWarnings");
      expect(result.readback?.rules).toBeUndefined();
    }
  });

  it("keeps write failures explicit without reporting unconfirmed success", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const response = await app.request(
      "/action/rules/delete",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleId: "rule-still-listed"
        })
      },
      env
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        executionStatus: "delete_not_confirmed",
        request: { method: "DELETE", path: "/rules/rule-still-listed" },
        response: { status: 200 },
        readback: { confirmed: false, status: 200 },
        error: { code: "READBACK_NOT_CONFIRMED" }
      }
    });
  });

  it("confirms deletion when SmartThings returns 403 for missing detail and the same-PAT list is absent", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    let deleted = false;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.pathname === "/v1/rules/rule-forbidden-after-delete") {
        if (method === "DELETE") {
          deleted = true;
          return jsonResponse(null, 200);
        }
        return deleted
          ? jsonResponse(null, 403)
          : jsonResponse({
              id: "rule-forbidden-after-delete",
              name: "SmartThings 403 tombstone Rule",
              actions: []
            });
      }

      if (
        url.pathname === "/v1/rules" &&
        url.searchParams.get("locationId") === "loc-1" &&
        method === "GET"
      ) {
        return jsonResponse({ items: [] });
      }

      return jsonResponse({ error: "not found" }, 404);
    });

    const response = await app.request(
      "/action/rules/delete",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleId: "rule-forbidden-after-delete"
        })
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      structuredContent: {
        ok: true,
        executionStatus: "deleted",
        response: { status: 200 },
        readback: {
          confirmed: true,
          status: 403,
          body: {
            detail: null,
            listReadback: { rulePresent: false }
          }
        }
      }
    });
  });



  it("does not create a Rule when the confirmed name already exists", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const response = await app.request(
      "/action/rules/create",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleJson: {
            ...switchOnRuleJson(),
            name: "  밤   11시 거실등 끄기  "
          }
        })
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        executionStatus: "duplicate_name",
        duplicateRule: {
          id: "rule-1",
          name: "밤 11시 거실등 끄기",
          locationId: "loc-1"
        }
      }
    });
    expect(hasSmartThingsPostRuleCall(fetchMock)).toBe(false);
  });









  it("does not delete a Rule when the same PAT cannot read it before deletion", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const response = await app.request(
      "/action/rules/delete",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleId: "missing-rule"
        })
      },
      env
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "SMARTTHINGS_API_ERROR"
    });
    expect(hasSmartThingsDeleteRuleCall(fetchMock, "missing-rule")).toBe(false);
  });





  it("does not change Rule status when the same PAT cannot read it first", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const response = await app.request(
      "/action/rules/set-status",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleId: "missing-rule",
          targetStatus: "Disabled"
        })
      },
      env
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "SMARTTHINGS_API_ERROR"
    });
    expect(hasSmartThingsSetStatusCall(fetchMock, "missing-rule", "disable")).toBe(false);
  });






  it("does not keep legacy proposal validation routes", async () => {
    const propose = await app.request("/action/rules/propose", { method: "POST" }, env);
    expect(propose.status).toBe(404);

    const validate = await app.request(
      "/action/proposals/validate",
      { method: "POST" },
      env
    );
    expect(validate.status).toBe(404);

    const validateJson = await app.request(
      "/action/rules/validate-json",
      { method: "POST" },
      env
    );
    expect(validateJson.status).toBe(404);
  });

  it("checks Rule JSON references without requiring reference metadata", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const response = await app.request(
      "/action/rules/check-json-references",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleJson: switchOnRuleJson()
        })
      },
      env
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      structuredContent: {
        ok: true,
        referencesOk: true,
        errors: [],
        guidance: {
          next: {
            step: "show_checked_draft"
          }
        }
      }
    });
    expect(body).not.toHaveProperty("referencedRules");
    expect(body.structuredContent as Record<string, unknown>).not.toHaveProperty(
      "referencedRules"
    );
  });

  it("checks edited Rule JSON and reports device, component, or capability errors", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const valid = await app.request(
      "/action/rules/check-json-references",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleJson: switchOnRuleJson()
        })
      },
      env
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({
      structuredContent: {
        ok: true,
        referencesOk: true,
        errors: [],
        guidance: {
          next: {
            step: "show_checked_draft"
          }
        }
      }
    });

    const invalid = await app.request(
      "/action/rules/check-json-references",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleJson: {
            name: "거실등 토글",
            actions: [
              {
                command: {
                  devices: ["dev-1"],
                  commands: [
                    {
                      component: "icemaker",
                      capability: "switch",
                      command: "on",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        })
      },
      env
    );
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toMatchObject({
      structuredContent: {
        ok: true,
        referencesOk: false,
        guidance: {
          next: {
            step: "draft_rule_json",
            tool: "checkRuleJsonReferences"
          }
        },
        errors: expect.arrayContaining([
          expect.objectContaining({
            code: "DEVICE_COMPONENT_MISSING",
            message: expect.any(String),
            path: expect.any(String)
          })
        ])
      }
    });

    const invalidCapability = await app.request(
      "/action/rules/check-json-references",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleJson: {
            name: "거실등 색상",
            actions: [
              {
                command: {
                  devices: ["dev-1"],
                  commands: [
                    {
                      component: "main",
                      capability: "colorControl",
                      command: "setColor",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        })
      },
      env
    );
    expect(invalidCapability.status).toBe(200);
    expect(await invalidCapability.json()).toMatchObject({
      structuredContent: {
        ok: true,
        referencesOk: false,
        errors: expect.arrayContaining([
          expect.objectContaining({
            code: "DEVICE_CAPABILITY_MISSING",
            message: expect.any(String),
            path: expect.any(String)
          })
        ])
      }
    });
  });

  it("ignores unknown Rule constructs when they contain no checkable references", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    fetchMock.mockClear();

    const response = await app.request(
      "/action/rules/check-json-references",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleJson: {
            name: "Custom Rule",
            actions: [
              {
                customFutureConstruct: {
                  value: "not yet modeled"
                }
              }
            ]
          }
        })
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      structuredContent: {
        ok: true,
        referencesOk: true,
        errors: []
      }
    });
    expect(hasSmartThingsDeviceListCall(fetchMock)).toBe(false);
  });

  it("does not treat command names as reference integrity errors", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const response = await app.request(
      "/action/rules/check-json-references",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          locationId: "loc-1",
          ruleJson: {
            name: "도어락 열기 검증",
            actions: [
              {
                command: {
                  devices: ["dev-1"],
                  commands: [
                    {
                      component: "main",
                      capability: "switch",
                      command: "toggle",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        })
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      structuredContent: {
        ok: true,
        referencesOk: true,
        errors: []
      }
    });
  });

  it("never completes OAuth approval from a GET query", async () => {
    const registered = await workerRequest(
      "/oauth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://client.example/callback"],
          client_name: "Rules Copilot GET bypass test",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_post"
        })
      },
      env
    );
    const client = (await registered.json()) as { client_id: string };

    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const authorizeUrl = new URL("http://localhost/oauth/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", client.client_id);
    authorizeUrl.searchParams.set("redirect_uri", "https://client.example/callback");
    authorizeUrl.searchParams.set("scope", "smartthings:rules");
    authorizeUrl.searchParams.set(
      "code_challenge",
      await sha256Base64UrlForTest("get-bypass-test-verifier")
    );
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("approve", "1");

    const response = await workerRequest(
      authorizeUrl,
      { headers: { Cookie: cookie } },
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.text()).toContain("연결 승인");

    authorizeUrl.searchParams.delete("approve");
    authorizeUrl.searchParams.set("scope", "read");
    const unsupportedScope = await workerRequest(
      authorizeUrl,
      { headers: { Cookie: cookie } },
      env
    );
    expect(unsupportedScope.status).toBe(400);
    expect(await unsupportedScope.json()).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST"
    });

    authorizeUrl.searchParams.set("scope", "smartthings:rules");
    authorizeUrl.searchParams.set("code_challenge_method", "plain");
    const plainPkce = await workerRequest(
      authorizeUrl,
      { headers: { Cookie: cookie } },
      env
    );
    expect(plainPkce.status).toBe(400);
  });

  it("issues OAuth tokens that map back to the web session connection", async () => {
    const registered = await workerRequest(
      "/oauth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://client.example/callback"],
          client_name: "Rules Copilot integration test",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_post"
        })
      },
      env
    );
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as {
      client_id: string;
      client_secret: string;
      client_id_issued_at: number;
      client_secret_expires_at: number;
    };
    expect(client.client_secret_expires_at - client.client_id_issued_at).toBe(
      30 * 24 * 60 * 60
    );

    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const codeVerifier = "test-oauth-code-verifier";
    const codeChallenge = await sha256Base64UrlForTest(codeVerifier);
    const authorizeUrl = new URL("http://localhost/oauth/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", client.client_id);
    authorizeUrl.searchParams.set("redirect_uri", "https://client.example/callback");
    authorizeUrl.searchParams.set("state", "state-1");
    authorizeUrl.searchParams.set("scope", "smartthings:rules");
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const { consent, consentBody, csrfToken, authorized } = await approveOAuthRequest(
      authorizeUrl,
      cookie,
      env
    );
    expect(consent.status).toBe(200);
    expect(consentBody).toContain("연결 승인");
    expect(consentBody).toContain("Rules Copilot integration test");
    expect(consentBody).toContain("SmartThings Rules 조회 및 관리");
    expect(consentBody).toContain("공식 GPT/Claude 지침");
    expect(consentBody).toContain("독립적으로 검증하지 않습니다");
    expect(consentBody).toContain("smartthings:rules");
    expect(consentBody).toContain('form method="post"');
    expect(consentBody).toContain("/oauth/authorize/approve");
    expect(consentBody).not.toContain("승인 처리 중");
    expect(consent.headers.get("Cache-Control")).toBe("no-store");
    expect(consent.headers.get("Content-Security-Policy")).not.toContain(
      "form-action"
    );
    expect(consent.headers.get("Set-Cookie")).toBeNull();

    const missingCsrfUrl = new URL(authorizeUrl);
    missingCsrfUrl.pathname = "/oauth/authorize/approve";
    const missingCsrf = await workerRequest(
      missingCsrfUrl,
      {
        method: "POST",
        headers: {
          Cookie: cookiePair(cookie),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ decision: "approve" }).toString()
      },
      env
    );
    expect(missingCsrf.status).toBe(403);

    const replayCsrf = await workerRequest(
      missingCsrfUrl,
      {
        method: "POST",
        headers: {
          Cookie: cookiePair(cookie),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          csrf_token: csrfToken,
          decision: "approve"
        }).toString()
      },
      env
    );
    expect(replayCsrf.status).toBe(403);

    expect(authorized.status).toBe(302);
    const redirect = new URL(authorized.headers.get("Location") ?? "");
    expect(redirect.origin + redirect.pathname).toBe("https://client.example/callback");
    expect(redirect.searchParams.get("state")).toBe("state-1");
    const code = redirect.searchParams.get("code") ?? "";
    expect(code).not.toBe("");

    const tokenRequestBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "https://client.example/callback",
      client_id: client.client_id,
      client_secret: client.client_secret,
      code_verifier: codeVerifier
    }).toString();
    const token = await workerRequest(
      "/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenRequestBody
      },
      env
    );
    expect(token.status).toBe(200);
    const tokenBody = (await token.json()) as {
      access_token: string;
      refresh_token: string;
      scope: string;
      token_type: string;
      expires_in: number;
    };
    expect(tokenBody.token_type).toBe("Bearer");
    expect(tokenBody.expires_in).toBe(60 * 60);
    expect(tokenBody.refresh_token).not.toBe("");
    expect(tokenBody.scope).toBe("smartthings:rules");

    const locations = await workerRequest(
      "/action/locations",
      { headers: { Authorization: `Bearer ${tokenBody.access_token}` } },
      env
    );
    expect(locations.status).toBe(200);
    expect(await locations.json()).toMatchObject({
      structuredContent: {
        ok: true,
        locations: [{ locationId: "loc-1", name: "Home" }]
      }
    });

    const refreshed = await workerRequest(
      "/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokenBody.refresh_token,
          client_id: client.client_id,
          client_secret: client.client_secret,
          scope: "smartthings:rules"
        }).toString()
      },
      env
    );
    expect(refreshed.status).toBe(200);
    const refreshedBody = (await refreshed.json()) as {
      access_token: string;
      expires_in: number;
      scope: string;
      token_type: string;
    };
    expect(refreshedBody.token_type).toBe("Bearer");
    expect(refreshedBody.expires_in).toBe(60 * 60);
    expect(refreshedBody.scope).toBe("smartthings:rules");
    const refreshedLocations = await workerRequest(
      "/action/locations",
      { headers: { Authorization: `Bearer ${refreshedBody.access_token}` } },
      env
    );
    expect(refreshedLocations.status).toBe(200);

    const reusedCode = await workerRequest(
      "/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenRequestBody
      },
      env
    );
    expect(reusedCode.status).toBe(400);
    expect(await reusedCode.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("reconciles only the deploy-configured GPT callbacks and preserves the client secret", async () => {
    const initialRedirectUri =
      "https://chat.openai.com/aip/g-before-builder-save/oauth/callback";
    const configuredRedirectUris = [
      "https://chat.openai.com/aip/g-after-builder-save/oauth/callback",
      "https://chatgpt.com/aip/g-after-builder-save/oauth/callback"
    ];
    const registered = await workerRequest(
      "/oauth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [initialRedirectUri],
          client_name: "Rules Copilot GPT callback reconciliation test",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_post"
        })
      },
      env
    );
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as {
      client_id: string;
      client_secret: string;
    };
    env.GPT_ACTIONS_CLIENT_ID = client.client_id;
    env.GPT_ACTIONS_REDIRECT_URIS = JSON.stringify(configuredRedirectUris);

    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const authorizeUrl = new URL("http://localhost/oauth/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", client.client_id);
    authorizeUrl.searchParams.set("redirect_uri", configuredRedirectUris[0]);
    authorizeUrl.searchParams.set("state", "gpt-callback-reconciled");
    authorizeUrl.searchParams.set("scope", "smartthings:rules");

    const reconciliation = await workerRequest(
      authorizeUrl,
      { headers: { Cookie: cookie } },
      env
    );
    expect(reconciliation.status).toBe(302);
    expect(reconciliation.headers.get("Location")).toBe(authorizeUrl.toString());
    expect(reconciliation.headers.get("Cache-Control")).toBe("no-store");

    const { authorized } = await approveOAuthRequest(authorizeUrl, cookie, env);
    expect(authorized.status).toBe(302);
    const redirect = new URL(authorized.headers.get("Location") ?? "");
    expect(redirect.origin + redirect.pathname).toBe(configuredRedirectUris[0]);
    const code = redirect.searchParams.get("code") ?? "";
    expect(code).not.toBe("");

    const token = await workerRequest(
      "/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: configuredRedirectUris[0],
          client_id: client.client_id,
          client_secret: client.client_secret
        }).toString()
      },
      env
    );
    expect(token.status).toBe(200);

    authorizeUrl.searchParams.set("redirect_uri", configuredRedirectUris[1]);
    const secondConfiguredCallback = await workerRequest(
      authorizeUrl,
      { headers: { Cookie: cookie } },
      env
    );
    expect(secondConfiguredCallback.status).toBe(200);

    authorizeUrl.searchParams.set("redirect_uri", initialRedirectUri);
    const staleCallback = await workerRequest(
      authorizeUrl,
      { headers: { Cookie: cookie } },
      env
    );
    expect(staleCallback.status).not.toBe(200);
  });

  it("does not reconcile a GPT callback outside the deploy allowlist", async () => {
    const initialRedirectUri =
      "https://chat.openai.com/aip/g-original-client/oauth/callback";
    const registered = await workerRequest(
      "/oauth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [initialRedirectUri],
          client_name: "Rules Copilot GPT callback rejection test",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_post"
        })
      },
      env
    );
    const client = (await registered.json()) as { client_id: string };
    env.GPT_ACTIONS_CLIENT_ID = client.client_id;
    env.GPT_ACTIONS_REDIRECT_URIS = JSON.stringify([
      "https://chat.openai.com/aip/g-configured-client/oauth/callback"
    ]);

    const authorizeUrl = new URL("http://localhost/oauth/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", client.client_id);
    authorizeUrl.searchParams.set(
      "redirect_uri",
      "https://chat.openai.com/aip/g-untrusted-client/oauth/callback"
    );
    authorizeUrl.searchParams.set("scope", "smartthings:rules");
    const untrustedCallback = await workerRequest(authorizeUrl, {}, env);
    expect(untrustedCallback.status).not.toBe(200);

    authorizeUrl.searchParams.set("redirect_uri", initialRedirectUri);
    const originalCallback = await workerRequest(authorizeUrl, {}, env);
    expect(originalCallback.status).toBe(302);
    expect(originalCallback.headers.get("Location")).toContain("/connect");
  });

  it.each(["client_secret_post", "client_secret_basic"] as const)(
    "supports confidential %s OAuth clients without PKCE",
    async (tokenEndpointAuthMethod) => {
      const redirectUri = "https://chat.openai.com/aip/g-test/oauth/callback";
      const registered = await workerRequest(
        "/oauth/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            redirect_uris: [redirectUri],
            client_name: `Rules Copilot ${tokenEndpointAuthMethod} test`,
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: tokenEndpointAuthMethod
          })
        },
        env
      );
      const client = (await registered.json()) as {
        client_id: string;
        client_secret: string;
      };

      const session = await app.request("/api/session", { method: "POST" }, env);
      const cookie = session.headers.get("Set-Cookie") ?? "";
      await app.request(
        "/api/smartthings/connect",
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ pat: PAT })
        },
        env
      );

      const authorizeUrl = new URL("http://localhost/oauth/authorize");
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("client_id", client.client_id);
      authorizeUrl.searchParams.set("redirect_uri", redirectUri);
      authorizeUrl.searchParams.set("state", "gpt-actions-state");
      authorizeUrl.searchParams.set("scope", "smartthings:rules");

      const { authorized } = await approveOAuthRequest(authorizeUrl, cookie, env);
      expect(authorized.status).toBe(302);
      const redirect = new URL(authorized.headers.get("Location") ?? "");
      expect(redirect.origin + redirect.pathname).toBe(redirectUri);
      expect(redirect.searchParams.get("state")).toBe("gpt-actions-state");
      const code = redirect.searchParams.get("code") ?? "";
      expect(code).not.toBe("");

      const tokenRequestBody = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        ...(tokenEndpointAuthMethod === "client_secret_post"
          ? {
              client_id: client.client_id,
              client_secret: client.client_secret
            }
          : {})
      });
      const token = await workerRequest(
        "/oauth/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(tokenEndpointAuthMethod === "client_secret_basic"
              ? {
                  Authorization: `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}`
                }
              : {})
          },
          body: tokenRequestBody.toString()
        },
        env
      );
      expect(token.status).toBe(200);
      expect(await token.json()).toMatchObject({
        token_type: "Bearer",
        scope: "smartthings:rules",
        expires_in: 60 * 60
      });
    }
  );

  it("supports public PKCE OAuth clients without a client secret", async () => {
    const registered = await workerRequest(
      "/oauth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["http://127.0.0.1:6311/callback/test"],
          client_name: "Rules Copilot public test client",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none"
        })
      },
      env
    );
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as {
      client_id: string;
      client_secret?: string;
      token_endpoint_auth_method: string;
    };
    expect(client.client_secret).toBeUndefined();
    expect(client.token_endpoint_auth_method).toBe("none");

    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const redirectUri = "http://127.0.0.1:6311/callback/test";
    const missingPkceUrl = new URL("http://localhost/oauth/authorize");
    missingPkceUrl.searchParams.set("response_type", "code");
    missingPkceUrl.searchParams.set("client_id", client.client_id);
    missingPkceUrl.searchParams.set("redirect_uri", redirectUri);
    missingPkceUrl.searchParams.set("scope", "smartthings:rules");
    const missingPkce = await workerRequest(
      missingPkceUrl,
      { headers: { Cookie: cookiePair(cookie) } },
      env
    );
    expect(missingPkce.status).toBe(400);

    const codeVerifier = "codex-public-pkce-verifier";
    const codeChallenge = await sha256Base64UrlForTest(codeVerifier);
    const authorizeUrl = new URL("http://localhost/oauth/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", client.client_id);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", "smartthings:rules");
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const { authorized } = await approveOAuthRequest(authorizeUrl, cookie, env);
    expect(authorized.status).toBe(302);
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
          redirect_uri: redirectUri,
          client_id: client.client_id,
          code_verifier: codeVerifier
        }).toString()
      },
      env
    );
    expect(token.status).toBe(200);
    const tokenBody = (await token.json()) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
    };
    expect(tokenBody.access_token).not.toBe("");
    expect(tokenBody.refresh_token).not.toBe("");
    expect(tokenBody.token_type).toBe("Bearer");
    expect(tokenBody.expires_in).toBe(60 * 60);
  });

  it("keeps OAuth access tokens when the PAT is changed", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const accessToken = await issueOAuthAccessToken(cookie, env);
    const beforeReconnect = await workerRequest(
      "/action/locations",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env
    );
    expect(beforeReconnect.status).toBe(200);

    const reconnect = await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: `${PAT}_new` })
      },
      env
    );
    expect(reconnect.status).toBe(200);

    const afterReconnect = await workerRequest(
      "/action/locations",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env
    );
    expect(afterReconnect.status).toBe(200);
  });

  it("keeps OAuth access tokens across SmartThings disconnect and reconnect", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const accessToken = await issueOAuthAccessToken(cookie, env);
    const disconnect = await app.request(
      "/api/smartthings/token",
      {
        method: "DELETE",
        headers: { Cookie: cookie }
      },
      env
    );
    expect(disconnect.status).toBe(200);
    expect(disconnect.headers.get("Set-Cookie")).toBeNull();

    const afterDisconnect = await workerRequest(
      "/action/locations",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env
    );
    expect(afterDisconnect.status).toBe(401);
    expect(await afterDisconnect.json()).toMatchObject({
      ok: false,
      code: "SMARTTHINGS_PAT_EXPIRED"
    });

    const reconnect = await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: `${PAT}_new` })
      },
      env
    );
    expect(reconnect.status).toBe(200);

    const afterReconnect = await workerRequest(
      "/action/locations",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env
    );
    expect(afterReconnect.status).toBe(200);
  });

  it("returns a reconnect ticket for an OAuth token whose PAT is missing", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const accessToken = await issueOAuthAccessToken(cookie, env);
    await app.request(
      "/api/smartthings/token",
      {
        method: "DELETE",
        headers: { Cookie: cookie }
      },
      env
    );

    const response = await workerRequest(
      "/action/status",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env
    );

    expect(response.status).toBe(401);
    const body = (await response.json()) as {
      code: string;
      messageForUser: string;
      reconnectUrl: string;
    };
    expect(body.code).toBe("SMARTTHINGS_PAT_EXPIRED");
    expect(body.reconnectUrl).toMatch(
      /^http:\/\/localhost\/connect#reconnect=rt_/u
    );
    expect(body.messageForUser).toContain(body.reconnectUrl);

    const reconnectUrl = new URL(body.reconnectUrl);
    expect(reconnectUrl.search).toBe("");
    expect(reconnectUrl.hash).toMatch(/^#reconnect=rt_/u);
    const ticket = new URLSearchParams(reconnectUrl.hash.slice(1)).get("reconnect") ?? "";
    const connectionId = connectionIdFromCookie(cookie);
    expect(ticket).not.toContain(connectionId);
    const ticketPayload = await decryptReconnectTicket(
      ticket,
      env.ST_TOKEN_ENC_KEY
    );
    expect(ticketPayload.connectionId).toBe(connectionId);
    expect(ticketPayload.expiresAt).toBeGreaterThan(
      Date.now() + (RECONNECT_TICKET_TTL_SECONDS - 60) * 1000
    );
    expect(
      await env.CONNECTION_GATE
        .getByName(connectionId)
        .hasReconnectNonce(ticketPayload.nonce, Date.now())
    ).toBe(true);
    expect([...kv.values.keys()].some((key) => key.startsWith("reconnect:"))).toBe(
      false
    );
  });

  it("stores a reconnect PAT on the ticket connection and resets the browser cookie", async () => {
    const oldSession = await app.request("/api/session", { method: "POST" }, env);
    const oldCookie = oldSession.headers.get("Set-Cookie") ?? "";
    const oldConnectionId = connectionIdFromCookie(oldCookie);
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: oldCookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    const accessToken = await issueOAuthAccessToken(oldCookie, env);
    await app.request(
      "/api/smartthings/token",
      {
        method: "DELETE",
        headers: { Cookie: oldCookie }
      },
      env
    );

    const expired = await workerRequest(
      "/action/status",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env
    );
    const expiredBody = (await expired.json()) as { reconnectUrl: string };
    const reconnectTicket = reconnectTicketFromUrl(expiredBody.reconnectUrl);

    const newSession = await app.request("/api/session", { method: "POST" }, env);
    const newCookie = newSession.headers.get("Set-Cookie") ?? "";
    const newConnectionId = connectionIdFromCookie(newCookie);
    expect(newConnectionId).not.toBe(oldConnectionId);

    const reconnect = await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: newCookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: `${PAT}_new`, reconnectTicket })
      },
      env
    );

    expect(reconnect.status).toBe(200);
    expect(connectionIdFromCookie(reconnect.headers.get("Set-Cookie") ?? "")).toBe(
      oldConnectionId
    );
    expect(
      await env.CONNECTION_GATE.getByName(oldConnectionId).getPatEnvelope()
    ).not.toBeNull();
    expect(
      await env.CONNECTION_GATE.getByName(newConnectionId).getPatEnvelope()
    ).toBeNull();
    expect([...kv.values.keys()].some((key) => /^(?:pat|reconnect):/u.test(key))).toBe(
      false
    );

    const afterReconnect = await workerRequest(
      "/action/locations",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env
    );
    expect(afterReconnect.status).toBe(200);

    const replay = await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: `${PAT}_replay`, reconnectTicket })
      },
      env
    );
    expect(replay.status).toBe(400);
  });

  it("rejects an invalid reconnect ticket without storing a PAT", async () => {
    const response = await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: PAT, reconnectTicket: "rt_missing" })
      },
      env
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not accept a reconnect ticket from the query string", async () => {
    const oldSession = await app.request("/api/session", { method: "POST" }, env);
    const oldCookie = oldSession.headers.get("Set-Cookie") ?? "";
    const oldConnectionId = connectionIdFromCookie(oldCookie);

    const newSession = await app.request("/api/session", { method: "POST" }, env);
    const newCookie = newSession.headers.get("Set-Cookie") ?? "";
    const newConnectionId = connectionIdFromCookie(newCookie);
    const response = await app.request(
      "/api/smartthings/connect?reconnect=rt_ignored",
      {
        method: "POST",
        headers: { Cookie: newCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(
      await env.CONNECTION_GATE.getByName(newConnectionId).getPatEnvelope()
    ).not.toBeNull();
    expect(
      await env.CONNECTION_GATE.getByName(oldConnectionId).getPatEnvelope()
    ).toBeNull();
  });

  it("invalidates issued reconnect tickets immediately when the connection is reset", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    const connectionId = connectionIdFromCookie(cookie);
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    const accessToken = await issueOAuthAccessToken(cookie, env);
    await app.request(
      "/api/smartthings/token",
      { method: "DELETE", headers: { Cookie: cookie } },
      env
    );

    const expired = await workerRequest(
      "/action/status",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env
    );
    const expiredBody = (await expired.json()) as { reconnectUrl: string };
    const reconnectTicket = reconnectTicketFromUrl(expiredBody.reconnectUrl);
    expect(reconnectTicket).not.toBe("");

    const reset = await workerRequest(
      "/api/session/reset",
      { method: "POST", headers: { Cookie: cookie } },
      env
    );
    expect(reset.status).toBe(200);
    expect(
      await env.CONNECTION_GATE.getByName(connectionId).getPatEnvelope()
    ).toBeNull();

    const smartThingsCallsBeforeReplay = fetchMock.mock.calls.length;
    const replay = await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: `${PAT}_replay`, reconnectTicket })
      },
      env
    );
    expect(replay.status).toBe(400);
    expect(fetchMock.mock.calls).toHaveLength(smartThingsCallsBeforeReplay);

    const oldOAuthToken = await workerRequest(
      "/action/locations",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env
    );
    expect(oldOAuthToken.status).toBe(401);
    expect(await oldOAuthToken.json()).toMatchObject({ error: "invalid_token" });
  });

  it("resets the browser connection and revokes existing OAuth tokens", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    const oldConnectionId = connectionIdFromCookie(cookie);
    const accessToken = await issueOAuthAccessToken(cookie, env);

    const reset = await workerRequest(
      "/api/session/reset",
      {
        method: "POST",
        headers: { Cookie: cookie }
      },
      env
    );
    expect(reset.status).toBe(200);
    expect(reset.headers.get("Set-Cookie")).toContain("HttpOnly");
    const resetBody = await reset.json();
    expect(resetBody).toEqual({
      ok: true,
      connected: false
    });
    expect(JSON.stringify(resetBody)).not.toContain("connectionId");
    expect(
      await env.CONNECTION_GATE.getByName(oldConnectionId).getPatEnvelope()
    ).toBeNull();
    expect(
      [...oauthKv.values.keys()].some((key) => key.startsWith(`grant:${oldConnectionId}:`))
    ).toBe(false);
    expect(
      [...oauthKv.values.keys()].some((key) => key.startsWith(`token:${oldConnectionId}:`))
    ).toBe(false);

    const afterReset = await workerRequest(
      "/action/locations",
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env
    );
    expect(afterReset.status).toBe(401);
    expect(await afterReset.json()).toMatchObject({ error: "invalid_token" });
  });

  it("advertises OAuth metadata and protects MCP without credentials", async () => {
    const metadata = await workerRequest(
      "/.well-known/oauth-authorization-server",
      {},
      env
    );
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      authorization_endpoint: "http://localhost/oauth/authorize",
      token_endpoint: "http://localhost/oauth/token",
      registration_endpoint: "http://localhost/oauth/register",
      scopes_supported: ["smartthings:rules"],
      code_challenge_methods_supported: ["S256"]
    });

    const response = await workerRequest(
      "/mcp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      },
      env
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "/.well-known/oauth-protected-resource/mcp"
    );
  });

  it("registers the Rule JSON reference check MCP tool without legacy proposal tools", async () => {
    const session = await app.request("/api/session", { method: "POST" }, env);
    const cookie = session.headers.get("Set-Cookie") ?? "";
    const initializeResponse = await workerRequest(
      "/mcp",
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "vitest", version: "1.0.0" }
          }
        })
      },
      env
    );
    expect(initializeResponse.status).toBe(200);
    const initializePayload = await mcpJsonRpcPayload(initializeResponse);
    expect((initializePayload.result as { instructions?: string }).instructions).toBe(
      mcpServerInstructions
    );
    const toolsResponse = await workerRequest(
      "/mcp",
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      },
      env
    );
    expect(toolsResponse.status).toBe(200);
    const toolsPayload = await mcpJsonRpcPayload(toolsResponse);
    const tools = ((toolsPayload.result as { tools?: unknown[] } | undefined)?.tools ?? []) as Array<{
      name: string;
      description?: string;
      inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
      annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
      };
      outputSchema?: unknown;
    }>;
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining([
      toolNames.checkRuleJsonReferences,
      toolNames.createRuleConfirmed,
      toolNames.updateRuleConfirmed,
      toolNames.deleteRuleConfirmed,
      toolNames.setRuleStatusConfirmed
    ]));
    expect(names).not.toEqual(expect.arrayContaining([
      "st_validate_rule_json",
      "st_propose_rule",
      "st_validate_proposal"
    ]));
    for (const [key, name] of Object.entries(toolNames)) {
      expect(tools.find((tool) => tool.name === name)?.description).toBe(
        toolDescriptions[key as keyof typeof toolDescriptions]
      );
    }
    for (const name of [
      toolNames.createRuleConfirmed,
      toolNames.updateRuleConfirmed,
      toolNames.deleteRuleConfirmed,
      toolNames.setRuleStatusConfirmed
    ]) {
      expect(tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      });
    }
    expect(Object.keys(tools.find((tool) => tool.name === toolNames.createRuleConfirmed)?.inputSchema?.properties ?? {})).toEqual(["locationId", "ruleJson"]);
    expect(Object.keys(tools.find((tool) => tool.name === toolNames.updateRuleConfirmed)?.inputSchema?.properties ?? {})).toEqual(["locationId", "ruleId", "ruleJson"]);
    expect(Object.keys(tools.find((tool) => tool.name === toolNames.deleteRuleConfirmed)?.inputSchema?.properties ?? {})).toEqual(["locationId", "ruleId"]);
    expect(Object.keys(tools.find((tool) => tool.name === toolNames.setRuleStatusConfirmed)?.inputSchema?.properties ?? {})).toEqual(["locationId", "ruleId", "targetStatus"]);
    expect(tools.every((tool) => tool.outputSchema === undefined)).toBe(true);

    await app.request(
      "/api/smartthings/connect",
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ pat: PAT })
      },
      env
    );
    const devicesResponse = await workerRequest(
      "/mcp",
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: toolNames.listDevices,
            arguments: { locationId: "loc-1" }
          }
        })
      },
      env
    );
    expect(devicesResponse.status).toBe(200);
    const devicesPayload = await mcpJsonRpcPayload(devicesResponse);
    expect(JSON.stringify(devicesPayload)).toContain('"deviceId":"dev-1"');
    expect(JSON.stringify(devicesPayload)).not.toContain("capabilityVersions");

    await app.request(
      "/api/smartthings/token",
      { method: "DELETE", headers: { Cookie: cookie } },
      env
    );
    const expiredResponse = await workerRequest(
      "/mcp",
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Cookie: cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: toolNames.getStatus, arguments: {} }
        })
      },
      env
    );
    expect(expiredResponse.status).toBe(200);
    const expiredPayload = await mcpJsonRpcPayload(expiredResponse);
    expect(JSON.stringify(expiredPayload)).toContain("SMARTTHINGS_PAT_EXPIRED");
    expect(JSON.stringify(expiredPayload)).toContain("structuredContent");
    expect(JSON.stringify(expiredPayload)).toContain("/connect#reconnect=rt_");
  });
});

async function mcpJsonRpcPayload(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  const dataLine = body
    .split(/\r?\n/u)
    .find((line) => line.startsWith("data:"));
  return JSON.parse(dataLine ? dataLine.slice("data:".length).trim() : body) as Record<
    string,
    unknown
  >;
}

function memoryRateLimit(maximum: number): RateLimit {
  const counts = new Map<string, number>();
  return {
    async limit({ key }) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { success: next <= maximum };
    }
  };
}

function bodyStream(size: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(size));
      controller.close();
    }
  });
}

function reconnectTicketFromUrl(value: string): string {
  const url = new URL(value);
  return new URLSearchParams(url.hash.slice(1)).get("reconnect") ?? "";
}
