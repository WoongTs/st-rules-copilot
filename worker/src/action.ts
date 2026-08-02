import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "./errors";
import {
  connectedStatusResultParts,
  capabilityContextResultParts,
  createRuleExecutionResultParts,
  deleteRuleExecutionResultParts,
  locationResultParts,
  referenceCheckResultParts,
  ruleDetailResultParts,
  ruleReferenceDetailResultParts,
  ruleReferenceSearchResultParts,
  rulesListResultParts,
  setRuleStatusExecutionResultParts,
  toolResult,
  updateRuleExecutionResultParts,
  type FlowToolNames
} from "./flow-guidance";
import { buildActionDevicePage } from "./action-device-pagination";
import { inspectCapabilityContextInputSchema } from "./capability-context";
import { compactDevicesForAi } from "./device-output";
import {
  maybeConnection,
  publicBaseUrl,
  readJson,
  requireExistingConnection
} from "./http-utils";
import {
  getRuleReference,
  referenceFiltersFromUrl,
  searchRuleReferences
} from "./rule-references";
import { SmartThingsService } from "./service";
import { SMARTTHINGS_RULES_SCOPE } from "./oauth";
import {
  createRuleConfirmedSchema,
  deleteRuleConfirmedSchema,
  deviceListCursorSchema,
  ruleJsonReferenceCheckSchema,
  setRuleStatusConfirmedSchema,
  toolDescriptions,
  toolNames,
  toolSummaries,
  updateRuleConfirmedSchema
} from "./tool-contracts";
import type { Env } from "./types";

const devicesQuerySchema = z.object({
  locationId: z.string().trim().min(1).optional(),
  cursor: deviceListCursorSchema
});

const rulesQuerySchema = z.object({
  locationId: z.string().trim().min(1)
});

export const actionApp = new Hono<{ Bindings: Env }>();

const actionToolNames: FlowToolNames = {
  listLocations: toolNames.listLocations,
  listDevices: toolNames.listDevices,
  inspectCapabilityContext: toolNames.inspectCapabilityContext,
  searchRuleReferences: toolNames.searchRuleReferences,
  getRuleReference: toolNames.getRuleReference,
  checkRuleJsonReferences: toolNames.checkRuleJsonReferences
};

actionApp.get("/openapi.json", (c) => c.json(buildOpenApi(c.req.raw, c.env)));

actionApp.get("/status", async (c) => {
  const connectionId = await maybeConnection(c.req.raw, c.env);
  if (!connectionId) {
    throw new AppError(
      "SMARTTHINGS_PAT_EXPIRED",
      401,
      "SmartThings 연결이 만료되었습니다. 웹앱에서 PAT를 다시 연결하세요."
    );
  }

  const service = new SmartThingsService(c.env);
  const status = await service.status(connectionId);
  if (!status.connected) {
    throw new AppError(
      "SMARTTHINGS_PAT_EXPIRED",
      401,
      "SmartThings 연결이 만료되었습니다. 웹앱에서 PAT를 다시 연결하세요."
    );
  }

  const parts = connectedStatusResultParts(actionToolNames);
  return c.json(toolResult(parts.text, {
    ok: true,
    ...status,
    ...(parts.guidance ? { guidance: parts.guidance } : {}),
    connected: true
  }));
});

actionApp.get("/locations", async (c) => {
  const connectionId = await requireExistingConnection(c.req.raw, c.env);
  const service = new SmartThingsService(c.env);
  const locations = await service.listLocations(connectionId);
  const parts = locationResultParts(locations, actionToolNames);
  return c.json(toolResult(parts.text, {
    ok: true,
    ...(parts.guidance ? { guidance: parts.guidance } : {}),
    locations
  }));
});

actionApp.get("/devices", async (c) => {
  const query = devicesQuerySchema.safeParse({
    locationId: c.req.query("locationId") || undefined,
    cursor: c.req.query("cursor") || undefined
  });
  if (!query.success) {
    throw new AppError("INVALID_REQUEST", 400, "기기 목록 요청이 올바르지 않습니다.");
  }

  const connectionId = await requireExistingConnection(c.req.raw, c.env);
  const service = new SmartThingsService(c.env);
  const devices = await service.listDevices(connectionId, query.data.locationId);
  const compactDevices = compactDevicesForAi(devices);
  return c.json(buildActionDevicePage({
    devices: compactDevices,
    cursor: query.data.cursor ?? 0,
    locationId: query.data.locationId,
    toolNames: actionToolNames
  }));
});

actionApp.get("/rules", async (c) => {
  const query = rulesQuerySchema.safeParse({
    locationId: c.req.query("locationId")
  });
  if (!query.success) {
    throw new AppError("INVALID_REQUEST", 400, "locationId를 선택하세요.");
  }

  const connectionId = await requireExistingConnection(c.req.raw, c.env);
  const service = new SmartThingsService(c.env);
  const rules = await service.listRules(connectionId, query.data.locationId);
  const parts = rulesListResultParts();
  return c.json(toolResult(`${rules.length}개 Rule을 찾았습니다. ${parts.text}`, {
    ok: true,
    ...(parts.guidance ? { guidance: parts.guidance } : {}),
    rules
  }));
});

actionApp.get("/rules/:ruleId", async (c) => {
  const query = rulesQuerySchema.safeParse({
    locationId: c.req.query("locationId")
  });
  const ruleId = c.req.param("ruleId").trim();
  if (!query.success || !ruleId) {
    throw new AppError("INVALID_REQUEST", 400, "locationId와 ruleId를 선택하세요.");
  }

  const connectionId = await requireExistingConnection(c.req.raw, c.env);
  const service = new SmartThingsService(c.env);
  const rule = await service.getRuleDetail(
    connectionId,
    query.data.locationId,
    ruleId
  );
  const parts = ruleDetailResultParts(rule.name);
  return c.json(toolResult(parts.text, {
    ok: true,
    ...(parts.guidance ? { guidance: parts.guidance } : {}),
    rule
  }));
});

actionApp.post("/rules/update", async (c) => {
  const body = updateRuleConfirmedSchema.safeParse(await readJson(c.req.raw));
  if (!body.success) {
    throw new AppError(
      "INVALID_REQUEST",
      400,
      "Rule 수정 요청에는 locationId, ruleId와 name/actions를 포함한 최종 전체 ruleJson이 필요합니다."
    );
  }

  const connectionId = await requireExistingConnection(c.req.raw, c.env);
  const service = new SmartThingsService(c.env);
  const result = await service.updateRuleChatConfirmed(connectionId, body.data);
  const parts = updateRuleExecutionResultParts(result.executionStatus);
  const response = toolResult(parts.text, {
    ...result
  });
  return c.json(result.ok ? response : { ...response, isError: true });
});

actionApp.post("/rules/delete", async (c) => {
  const body = deleteRuleConfirmedSchema.safeParse(await readJson(c.req.raw));
  if (!body.success) {
    throw new AppError(
      "INVALID_REQUEST",
      400,
      "Rule 삭제 요청에는 locationId와 ruleId가 필요합니다."
    );
  }

  const connectionId = await requireExistingConnection(c.req.raw, c.env);
  const service = new SmartThingsService(c.env);
  const result = await service.deleteRuleChatConfirmed(connectionId, body.data);
  const parts = deleteRuleExecutionResultParts(result.executionStatus);
  const response = toolResult(parts.text, {
    ...result
  });
  return c.json(result.ok ? response : { ...response, isError: true });
});

actionApp.post("/rules/set-status", async (c) => {
  const body = setRuleStatusConfirmedSchema.safeParse(await readJson(c.req.raw));
  if (!body.success) {
    throw new AppError(
      "INVALID_REQUEST",
      400,
      "Rule 활성/비활성 요청에는 locationId, ruleId와 targetStatus가 필요합니다."
    );
  }

  const connectionId = await requireExistingConnection(c.req.raw, c.env);
  const service = new SmartThingsService(c.env);
  const result = await service.setRuleStatusChatConfirmed(connectionId, body.data);
  const parts = setRuleStatusExecutionResultParts(result.executionStatus);
  const response = toolResult(parts.text, {
    ...result
  });
  return c.json(result.ok ? response : { ...response, isError: true });
});

actionApp.post("/rules/check-json-references", async (c) => {
  const body = ruleJsonReferenceCheckSchema.safeParse(await readJson(c.req.raw));
  if (!body.success) {
    throw new AppError(
      "INVALID_REQUEST",
      400,
      "Rule JSON 참조 점검 요청에는 locationId와 name/actions를 포함한 ruleJson이 필요합니다."
    );
  }

  const connectionId = await requireExistingConnection(c.req.raw, c.env);
  const service = new SmartThingsService(c.env);
  const check = await service.checkRuleJsonReferences(connectionId, body.data);
  const parts = referenceCheckResultParts(check.referencesOk, actionToolNames);
  const { messageForUser: _messageForUser, ...checkData } = check;
  return c.json(toolResult(parts.text, {
    ok: true,
    ...checkData,
    ...(parts.guidance ? { guidance: parts.guidance } : {})
  }));
});

actionApp.post("/rules/create", async (c) => {
  const body = createRuleConfirmedSchema.safeParse(await readJson(c.req.raw));
  if (!body.success) {
    throw new AppError(
      "INVALID_REQUEST",
      400,
      "Rule 생성 요청에는 locationId와 name/actions를 포함한 최종 ruleJson이 필요합니다."
    );
  }

  const connectionId = await requireExistingConnection(c.req.raw, c.env);
  const service = new SmartThingsService(c.env);
  const result = await service.createRuleChatConfirmed(connectionId, body.data);
  const parts = createRuleExecutionResultParts(result.executionStatus);
  const response = toolResult(parts.text, {
    ...result
  });
  return c.json(result.ok ? response : { ...response, isError: true });
});

actionApp.post("/capabilities/inspect-context", async (c) => {
  const body = inspectCapabilityContextInputSchema.safeParse(await readJson(c.req.raw));
  if (!body.success) {
    throw new AppError(
      "INVALID_REQUEST",
      400,
      "Capability context 조회 요청에는 locationId와 1~10개의 device/component/capability target이 필요합니다."
    );
  }

  const connectionId = await requireExistingConnection(c.req.raw, c.env);
  const service = new SmartThingsService(c.env);
  const result = await service.inspectCapabilityContext(connectionId, body.data);
  const parts = capabilityContextResultParts(actionToolNames);
  return c.json(toolResult(parts.text, {
    ok: true,
    contexts: result.contexts,
    ...(parts.guidance ? { guidance: parts.guidance } : {})
  }));
});

actionApp.get("/rule-references", (c) => {
  const references = searchRuleReferences(referenceFiltersFromUrl(c.req.url));
  const parts = ruleReferenceSearchResultParts();
  return c.json(toolResult(`${references.length}개 Rule 예시 참조를 찾았습니다. ${parts.text}`, {
    ok: true,
    ...(parts.guidance ? { guidance: parts.guidance } : {}),
    references
  }));
});

actionApp.get("/rule-references/:referenceId", (c) => {
  const reference = getRuleReference(c.req.param("referenceId"));
  if (!reference) {
    throw new AppError(
      "NOT_FOUND",
      404,
      "요청한 Rule 예시 참조를 찾을 수 없습니다."
    );
  }

  const parts = ruleReferenceDetailResultParts();
  return c.json(toolResult(parts.text, {
    ok: true,
    ...(parts.guidance ? { guidance: parts.guidance } : {}),
    reference
  }));
});

function buildOpenApi(request: Request, env: Env) {
  const baseUrl = publicBaseUrl(request, env);
  return {
    openapi: "3.1.0",
    info: {
      title: "SmartThings Rules Copilot Actions",
      version: "0.1.0",
      description:
        "SmartThings context, Rule JSON reference-check, and chat-confirmed Rule execution endpoints for GPT Actions."
    },
    servers: [{ url: `${baseUrl}/action` }],
    security: [{ OAuth2: [SMARTTHINGS_RULES_SCOPE] }],
    paths: {
      "/status": {
        get: {
          operationId: toolNames.getStatus,
          summary: toolSummaries.getStatus,
          description: toolDescriptions.getStatus,
          responses: {
            "200": {
              description: "SmartThings connection status",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StatusResponse" }
                }
              }
            }
          }
        }
      },
      "/locations": {
        get: {
          operationId: toolNames.listLocations,
          summary: toolSummaries.listLocations,
          description: toolDescriptions.listLocations,
          responses: jsonResponse("LocationListResponse")
        }
      },
      "/devices": {
        get: {
          operationId: toolNames.listDevices,
          summary: toolSummaries.listDevices,
          description: toolDescriptions.listDevices,
          parameters: [
            {
              name: "locationId",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Optional SmartThings location ID used to filter devices."
            },
            {
              name: "cursor",
              in: "query",
              required: false,
              schema: {
                type: "integer",
                minimum: 0,
                maximum: Number.MAX_SAFE_INTEGER
              },
              description:
                "Optional nextCursor from a previous listDevices result. Continue automatically while hasMore is true."
            }
          ],
          responses: jsonResponse("DeviceListResponse")
        }
      },
      "/capabilities/inspect-context": {
        post: {
          operationId: toolNames.inspectCapabilityContext,
          summary: toolSummaries.inspectCapabilityContext,
          description: toolDescriptions.inspectCapabilityContext,
          requestBody: jsonRequestBody("CapabilityContextInspectionInput"),
          responses: jsonResponse("CapabilityContextInspectionResponse")
        }
      },
      "/rules": {
        get: {
          operationId: toolNames.listRules,
          summary: toolSummaries.listRules,
          description: toolDescriptions.listRules,
          parameters: [
            {
              name: "locationId",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "SmartThings location ID."
            }
          ],
          responses: jsonResponse("RuleListResponse")
        }
      },
      "/rules/{ruleId}": {
        get: {
          operationId: toolNames.getRuleDetail,
          summary: toolSummaries.getRuleDetail,
          description: toolDescriptions.getRuleDetail,
          parameters: [
            {
              name: "ruleId",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "SmartThings Rule ID."
            },
            {
              name: "locationId",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "SmartThings location ID."
            }
          ],
          responses: jsonResponse("RuleDetailResponse")
        }
      },
      "/rules/update": {
        post: {
          operationId: toolNames.updateRuleConfirmed,
          summary: toolSummaries.updateRuleConfirmed,
          description: toolDescriptions.updateRuleConfirmed,
          requestBody: jsonRequestBody("UpdateRuleConfirmedInput"),
          responses: jsonResponse("UpdateRuleExecutionResponse")
        }
      },
      "/rules/delete": {
        post: {
          operationId: toolNames.deleteRuleConfirmed,
          summary: toolSummaries.deleteRuleConfirmed,
          description: toolDescriptions.deleteRuleConfirmed,
          requestBody: jsonRequestBody("DeleteRuleConfirmedInput"),
          responses: jsonResponse("DeleteRuleExecutionResponse")
        }
      },
      "/rules/set-status": {
        post: {
          operationId: toolNames.setRuleStatusConfirmed,
          summary: toolSummaries.setRuleStatusConfirmed,
          description: toolDescriptions.setRuleStatusConfirmed,
          requestBody: jsonRequestBody("SetRuleStatusConfirmedInput"),
          responses: jsonResponse("SetRuleStatusExecutionResponse")
        }
      },
      "/rules/check-json-references": {
        post: {
          operationId: toolNames.checkRuleJsonReferences,
          summary: toolSummaries.checkRuleJsonReferences,
          description: toolDescriptions.checkRuleJsonReferences,
          requestBody: jsonRequestBody("RuleJsonReferenceCheckInput"),
          responses: jsonResponse("RuleJsonReferenceCheckResponse")
        }
      },
      "/rules/create": {
        post: {
          operationId: toolNames.createRuleConfirmed,
          summary: toolSummaries.createRuleConfirmed,
          description: toolDescriptions.createRuleConfirmed,
          requestBody: jsonRequestBody("CreateRuleConfirmedInput"),
          responses: jsonResponse("CreateRuleExecutionResponse")
        }
      },
      "/rule-references": {
        get: {
          operationId: toolNames.searchRuleReferences,
          summary: toolSummaries.searchRuleReferences,
          description: toolDescriptions.searchRuleReferences,
          security: [],
          parameters: referenceSearchParameters(),
          responses: jsonResponse("RuleReferenceSearchResponse")
        }
      },
      "/rule-references/{referenceId}": {
        get: {
          operationId: toolNames.getRuleReference,
          summary: toolSummaries.getRuleReference,
          description: toolDescriptions.getRuleReference,
          security: [],
          parameters: [
            {
              name: "referenceId",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Rule reference example ID."
            }
          ],
          responses: jsonResponse("RuleReferenceDetailResponse")
        }
      }
    },
    components: {
      securitySchemes: {
        OAuth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: `${baseUrl}/oauth/authorize`,
              tokenUrl: `${baseUrl}/oauth/token`,
              scopes: {
                [SMARTTHINGS_RULES_SCOPE]:
                  "Read SmartThings locations, devices, and rules, and manage rules after explicit in-chat confirmation."
              }
            }
          }
        }
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          required: ["ok", "code", "messageForUser"],
          properties: {
            ok: { type: "boolean", const: false },
            code: { type: "string" },
            messageForUser: { type: "string" },
            reconnectUrl: { type: "string" }
          }
        },
        StatusResponse: {
          type: "object",
          ...toolResultSchema("StatusStructuredContent")
        },
        StatusStructuredContent: statusStructuredContentSchema(),
        Location: {
          type: "object",
          required: ["locationId", "name"],
          properties: {
            locationId: { type: "string" },
            name: { type: "string" }
          }
        },
        Device: {
          type: "object",
          required: ["deviceId", "label", "components"],
          description:
            "Compact device summary for GPT Actions. Device names, locationId, roomId, and top-level capabilities are omitted to keep large device lists under GPT Actions response limits.",
          properties: {
            deviceId: { type: "string" },
            label: { type: "string" },
            roomName: { type: "string" },
            components: {
              type: "array",
              description:
                "Component-level capability map. Use the matching componentId in Rule JSON when a device exposes subcomponents such as icemaker.",
              items: { $ref: "#/components/schemas/DeviceComponent" }
            }
          }
        },
        DeviceComponent: {
          type: "object",
          required: ["componentId", "capabilities"],
          properties: {
            componentId: { type: "string" },
            capabilities: {
              type: "array",
              items: { type: "string" }
            }
          }
        },
        CapabilityContextInspectionInput: capabilityContextInspectionInputSchema(),
        CapabilityContextTarget: capabilityContextTargetSchema(),
        CapabilityContextInclude: capabilityContextIncludeSchema(),
        CapabilityContextInspectionResponse: toolResultSchema(
          "CapabilityContextInspectionStructuredContent"
        ),
        CapabilityContextInspectionStructuredContent:
          capabilityContextInspectionStructuredContentSchema(),
        CapabilityContext: capabilityContextSchema(),
        CapabilityContextWarning: capabilityContextWarningSchema(),
        CapabilityContextNormalized: capabilityContextNormalizedSchema(),
        AttributeValueSchema: attributeValueSchema(),
        CommandArgumentSchema: commandArgumentSchema(),
        CommandArgument: commandArgumentOpenApiSchema(),
        StatusValue: statusValueSchema(),
        PresentationRef: presentationRefSchema(),
        Rule: {
          type: "object",
          required: ["id", "name", "locationId"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            locationId: { type: "string" },
            status: { type: "string" },
            ownerType: { type: "string" },
            ownerId: { type: "string" }
          }
        },
        LocationListResponse: toolResultSchema("LocationListStructuredContent"),
        LocationListStructuredContent: listStructuredContentSchema("locations", "Location"),
        DeviceListResponse: toolResultSchema("DeviceListStructuredContent"),
        DeviceListStructuredContent: deviceListStructuredContentSchema(),
        RuleListResponse: toolResultSchema("RuleListStructuredContent"),
        RuleListStructuredContent: listStructuredContentSchema("rules", "Rule"),
        RuleDetailResponse: {
          type: "object",
          ...toolResultSchema("RuleDetailStructuredContent")
        },
        RuleDetailStructuredContent: ruleDetailStructuredContentSchema(),
        RuleJsonReferenceCheckInput: ruleJsonReferenceCheckInputSchema(),
        SmartThingsRuleJsonDraft: smartThingsRuleJsonDraftSchema(),
        RuleJsonReferenceCheckIssue: ruleJsonReferenceCheckIssueSchema(),
        RuleJsonReferenceCheckResponse: toolResultSchema("RuleJsonReferenceCheckStructuredContent"),
        RuleJsonReferenceCheckStructuredContent: ruleJsonReferenceCheckStructuredContentSchema(),
        CreateRuleConfirmedInput: zodOpenApiSchema(createRuleConfirmedSchema),
        CreateRuleExecutionResponse: toolResultSchema("RuleWriteExecutionStructuredContent"),
        SmartThingsRawResponse: smartThingsRawResponseSchema(),
        UpdateRuleConfirmedInput: zodOpenApiSchema(updateRuleConfirmedSchema),
        UpdateRuleExecutionResponse: toolResultSchema("RuleWriteExecutionStructuredContent"),
        DeleteRuleConfirmedInput: zodOpenApiSchema(deleteRuleConfirmedSchema),
        DeleteRuleExecutionResponse: toolResultSchema("RuleWriteExecutionStructuredContent"),
        SetRuleStatusConfirmedInput: zodOpenApiSchema(setRuleStatusConfirmedSchema),
        SetRuleStatusExecutionResponse: toolResultSchema("RuleWriteExecutionStructuredContent"),
        RuleWriteExecutionStructuredContent: ruleWriteExecutionStructuredContentSchema(),
        RuleReferenceSearchResult: ruleReferenceSearchResultSchema(),
        RuleReference: ruleReferenceSchema(),
        ToolTextContent: toolTextContentSchema(),
        ToolGuidance: toolGuidanceSchema(),
        ToolNext: toolNextSchema(),
        ElicitationHint: elicitationHintSchema(),
        RuleReferenceSearchResponse: {
          type: "object",
          ...toolResultSchema("RuleReferenceSearchStructuredContent")
        },
        RuleReferenceSearchStructuredContent: ruleReferenceSearchStructuredContentSchema(),
        RuleReferenceDetailResponse: {
          type: "object",
          ...toolResultSchema("RuleReferenceDetailStructuredContent")
        },
        RuleReferenceDetailStructuredContent: ruleReferenceDetailStructuredContentSchema()
      }
    }
  };
}

function toolResultSchema(structuredContentSchemaName: string) {
  return {
    required: ["content", "structuredContent"],
    properties: {
      content: {
        type: "array",
        items: { $ref: "#/components/schemas/ToolTextContent" }
      },
      structuredContent: {
        $ref: `#/components/schemas/${structuredContentSchemaName}`
      },
      isError: { type: "boolean" }
    }
  };
}

function toolTextContentSchema() {
  return {
    type: "object",
    required: ["type", "text"],
    properties: {
      type: { type: "string", const: "text" },
      text: { type: "string" }
    }
  };
}

function toolGuidanceSchema() {
  return {
    type: "object",
    properties: {
      instructions: stringArraySchema(),
      next: { $ref: "#/components/schemas/ToolNext" },
      elicitation: { $ref: "#/components/schemas/ElicitationHint" }
    }
  };
}

function toolNextSchema() {
  return {
    type: "object",
    required: ["step", "reason"],
    properties: {
      step: {
        type: "string",
        enum: [
          "reconnect",
          "list_locations",
          "choose_location",
          "list_devices",
          "confirm_rule_targets",
          "inspect_capability_context",
          "search_rule_references",
          "get_rule_reference",
          "draft_rule_json",
          "check_rule_json_references",
          "show_checked_draft"
        ]
      },
      tool: { type: "string" },
      arguments: {
        type: "object",
        additionalProperties: true
      },
      reason: { type: "string" }
    }
  };
}

function elicitationHintSchema() {
  return {
    type: "object",
    required: ["message", "requestedSchema"],
    properties: {
      message: { type: "string" },
      requestedSchema: {
        type: "object",
        additionalProperties: true
      }
    }
  };
}

function jsonResponse(schemaName: string) {
  return {
    "200": {
      description: "Successful response",
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${schemaName}` }
        }
      }
    },
    "401": {
      description: "SmartThings PAT is missing or expired",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ErrorResponse" }
        }
      }
    }
  };
}

function jsonRequestBody(schemaName: string) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schemaName}` }
      }
    }
  };
}

function statusStructuredContentSchema() {
  return {
    type: "object",
    required: ["ok", "connected"],
    properties: {
      ok: { type: "boolean", const: true },
      connected: { type: "boolean" },
      expiresAt: { type: "string" },
      locationsCount: { type: "integer" },
      reconnectUrl: { type: "string" },
      guidance: { $ref: "#/components/schemas/ToolGuidance" }
    }
  };
}

function listStructuredContentSchema(
  propertyName: "locations" | "rules",
  itemSchema: string
) {
  return {
    type: "object",
    required: ["ok", propertyName],
    properties: {
      ok: { type: "boolean", const: true },
      guidance: { $ref: "#/components/schemas/ToolGuidance" },
      [propertyName]: {
        type: "array",
        items: { $ref: `#/components/schemas/${itemSchema}` }
      }
    }
  };
}

function deviceListStructuredContentSchema() {
  return {
    type: "object",
    required: ["ok", "devices", "totalCount", "hasMore"],
    properties: {
      ok: { type: "boolean", const: true },
      guidance: { $ref: "#/components/schemas/ToolGuidance" },
      devices: {
        type: "array",
        items: { $ref: "#/components/schemas/Device" }
      },
      totalCount: { type: "integer", minimum: 0 },
      hasMore: { type: "boolean" },
      nextCursor: {
        type: "integer",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER
      }
    }
  };
}

function ruleDetailStructuredContentSchema() {
  return {
    type: "object",
    required: ["ok", "rule"],
    properties: {
      ok: { type: "boolean", const: true },
      guidance: { $ref: "#/components/schemas/ToolGuidance" },
      rule: {
        allOf: [{ $ref: "#/components/schemas/Rule" }],
        additionalProperties: true
      }
    }
  };
}

function capabilityContextInspectionInputSchema() {
  return {
    type: "object",
    required: ["locationId", "targets"],
    properties: {
      locationId: {
        type: "string",
        description: "SmartThings location ID returned by listLocations."
      },
      targets: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: { $ref: "#/components/schemas/CapabilityContextTarget" }
      },
      include: { $ref: "#/components/schemas/CapabilityContextInclude" },
      presentationMode: {
        type: "string",
        enum: ["none", "automationOnly"],
        description:
          "Default is none. automationOnly returns only automation-focused presentation fields."
      }
    }
  };
}

function capabilityContextTargetSchema() {
  return {
    type: "object",
    required: ["deviceId", "componentId", "capabilityId"],
    properties: {
      deviceId: { type: "string" },
      componentId: { type: "string" },
      capabilityId: { type: "string" },
      capabilityVersion: {
        type: "integer",
        minimum: 1,
        description:
          "Optional. If omitted, the service resolves the SmartThings device capability version, then defaults to version 1."
      }
    }
  };
}

function capabilityContextIncludeSchema() {
  return {
    type: "object",
    properties: {
      definition: { type: "boolean", default: true },
      deviceStatus: { type: "boolean", default: true },
      presentation: { type: "boolean", default: false }
    }
  };
}

function capabilityContextInspectionStructuredContentSchema() {
  return {
    type: "object",
    required: ["ok", "contexts"],
    properties: {
      ok: { type: "boolean", const: true },
      guidance: { $ref: "#/components/schemas/ToolGuidance" },
      contexts: {
        type: "array",
        items: { $ref: "#/components/schemas/CapabilityContext" }
      }
    }
  };
}

function capabilityContextSchema() {
  return {
    type: "object",
    required: [
      "deviceId",
      "componentId",
      "capabilityId",
      "capabilityVersion",
      "definition",
      "deviceStatus",
      "presentation",
      "normalized",
      "warnings"
    ],
    properties: {
      deviceId: { type: "string" },
      deviceLabel: { type: "string" },
      componentId: { type: "string" },
      capabilityId: { type: "string" },
      capabilityVersion: { type: "integer" },
      definition: nullableObjectSchema(),
      deviceStatus: nullableObjectSchema(),
      presentation: nullableObjectSchema(),
      normalized: { $ref: "#/components/schemas/CapabilityContextNormalized" },
      warnings: {
        type: "array",
        items: { $ref: "#/components/schemas/CapabilityContextWarning" }
      }
    }
  };
}

function capabilityContextWarningSchema() {
  return {
    type: "object",
    required: ["code", "message"],
    properties: {
      code: { type: "string" },
      message: { type: "string" },
      path: { type: "string" }
    }
  };
}

function capabilityContextNormalizedSchema() {
  return {
    type: "object",
    required: [
      "attributeValueSchemas",
      "commandArgumentSchemas",
      "statusValues",
      "presentationRefs"
    ],
    properties: {
      attributeValueSchemas: {
        type: "array",
        items: { $ref: "#/components/schemas/AttributeValueSchema" }
      },
      commandArgumentSchemas: {
        type: "array",
        items: { $ref: "#/components/schemas/CommandArgumentSchema" }
      },
      statusValues: {
        type: "array",
        items: { $ref: "#/components/schemas/StatusValue" }
      },
      presentationRefs: {
        type: "array",
        items: { $ref: "#/components/schemas/PresentationRef" }
      }
    }
  };
}

function attributeValueSchema() {
  return {
    type: "object",
    required: [
      "attribute",
      "valueSchema",
      "unitSchema",
      "setter",
      "enumCommands",
      "sourcePath"
    ],
    properties: {
      attribute: { type: "string" },
      valueSchema: {},
      unitSchema: {},
      setter: { anyOf: [{ type: "string" }, { type: "null" }] },
      enumCommands: stringArraySchema(),
      sourcePath: { type: "string" }
    }
  };
}

function commandArgumentSchema() {
  return {
    type: "object",
    required: ["command", "arguments", "sensitive", "sourcePath"],
    properties: {
      command: { type: "string" },
      arguments: {
        type: "array",
        items: { $ref: "#/components/schemas/CommandArgument" }
      },
      sensitive: { type: "boolean" },
      sourcePath: { type: "string" }
    }
  };
}

function commandArgumentOpenApiSchema() {
  return {
    type: "object",
    required: ["name", "optional", "schema"],
    properties: {
      name: { type: "string" },
      optional: { type: "boolean" },
      schema: {}
    }
  };
}

function statusValueSchema() {
  return {
    type: "object",
    required: ["attribute", "kind", "value", "sourcePath"],
    properties: {
      attribute: { type: "string" },
      kind: { type: "string", enum: ["array", "object", "scalar"] },
      value: {},
      timestamp: { type: "string" },
      sourcePath: { type: "string" }
    }
  };
}

function presentationRefSchema() {
  return {
    type: "object",
    required: [
      "surface",
      "command",
      "value",
      "supportedValues",
      "alternatives",
      "sourcePath"
    ],
    properties: {
      surface: {
        type: "string",
        enum: ["automation.actions", "automation.conditions"]
      },
      label: { type: "string" },
      displayType: { type: "string" },
      command: { anyOf: [{ type: "string" }, { type: "null" }] },
      value: {},
      supportedValues: { anyOf: [{ type: "string" }, { type: "null" }] },
      alternatives: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true
        }
      },
      sourcePath: { type: "string" }
    }
  };
}

function nullableObjectSchema() {
  return {
    anyOf: [
      {
        type: "object",
        additionalProperties: true
      },
      { type: "null" }
    ]
  };
}

function ruleJsonReferenceCheckInputSchema() {
  return {
    type: "object",
    required: ["locationId", "ruleJson"],
    properties: {
      locationId: {
        type: "string",
        description: "SmartThings location ID returned by listLocations."
      },
      ruleJson: {
        $ref: "#/components/schemas/SmartThingsRuleJsonDraft",
        description:
          "SmartThings Rule JSON drafted by the model before calling this reference check."
      }
    }
  };
}

function smartThingsRuleJsonDraftSchema() {
  return {
    type: "object",
    required: ["name", "actions"],
    additionalProperties: true,
    properties: {
      name: {
        type: "string",
        description: "SmartThings Rule name."
      },
      actions: {
        type: "array",
        minItems: 1,
        description: "SmartThings Rules actions array drafted by the model.",
        items: {
          type: "object",
          additionalProperties: true
        }
      }
    }
  };
}

function ruleJsonReferenceCheckIssueSchema() {
  return {
    type: "object",
    required: ["code", "message", "path"],
    properties: {
      code: { type: "string" },
      message: { type: "string" },
      path: { type: "string" }
    }
  };
}

function ruleJsonReferenceCheckStructuredContentSchema() {
  return {
    type: "object",
    required: [
      "ok",
      "referencesOk",
      "errors"
    ],
    properties: {
      ok: { type: "boolean", const: true },
      referencesOk: {
        type: "boolean",
        description:
          "True only when no location/device/component/capability reference errors were found."
      },
      guidance: { $ref: "#/components/schemas/ToolGuidance" },
      errors: {
        type: "array",
        items: { $ref: "#/components/schemas/RuleJsonReferenceCheckIssue" }
      }
    }
  };
}

function zodOpenApiSchema(schema: z.ZodType) {
  const { $schema: _schema, ...openApiSchema } = z.toJSONSchema(schema);
  return openApiSchema;
}

function ruleWriteExecutionStructuredContentSchema() {
  return {
    type: "object",
    required: ["ok", "executionStatus", "request", "response", "readback"],
    properties: {
      ok: { type: "boolean" },
      executionStatus: {
        type: "string",
        enum: [
          "created",
          "create_not_confirmed",
          "duplicate_name",
          "updated",
          "update_not_confirmed",
          "deleted",
          "delete_not_confirmed",
          "enabled",
          "disabled",
          "already_enabled",
          "already_disabled",
          "rejected_by_smartthings",
          "status_not_confirmed"
        ]
      },
      before: { type: "object", additionalProperties: true },
      request: {
        anyOf: [
          {
            type: "object",
            required: ["method", "path", "query", "body"],
            properties: {
              method: { type: "string", enum: ["POST", "PUT", "DELETE"] },
              path: { type: "string" },
              query: { type: "object", additionalProperties: { type: "string" } },
              body: {}
            }
          },
          { type: "null" }
        ]
      },
      response: {
        anyOf: [
          { $ref: "#/components/schemas/SmartThingsRawResponse" },
          { type: "null" }
        ]
      },
      readback: {
        anyOf: [
          {
            type: "object",
            required: ["confirmed", "status", "body"],
            properties: {
              confirmed: { type: "boolean" },
              status: { type: "integer" },
              body: {}
            }
          },
          { type: "null" }
        ]
      },
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string" },
          message: { type: "string" }
        }
      },
      guidance: { $ref: "#/components/schemas/ToolGuidance" },
      duplicateRule: { $ref: "#/components/schemas/Rule" }
    }
  };
}

function smartThingsRawResponseSchema() {
  return {
    type: "object",
    required: ["status", "body"],
    properties: {
      status: { type: "integer" },
      body: {}
    }
  };
}

function ruleReferenceSearchStructuredContentSchema() {
  return {
    type: "object",
    required: ["ok", "references"],
    properties: {
      ok: { type: "boolean", const: true },
      guidance: { $ref: "#/components/schemas/ToolGuidance" },
      references: {
        type: "array",
        items: { $ref: "#/components/schemas/RuleReferenceSearchResult" }
      }
    }
  };
}

function ruleReferenceDetailStructuredContentSchema() {
  return {
    type: "object",
    required: ["ok", "reference"],
    properties: {
      ok: { type: "boolean", const: true },
      guidance: { $ref: "#/components/schemas/ToolGuidance" },
      reference: { $ref: "#/components/schemas/RuleReference" }
    }
  };
}

function referenceSearchParameters() {
  return [
    referenceQueryParameter("query", "Korean or English natural-language search across title, summary, aliases, tags, and indexed fields."),
    referenceQueryParameter("constructs", "Comma-separated Rule constructs such as if, every, command, sleep."),
    referenceQueryParameter("triggerCapabilities", "Comma-separated trigger capability IDs such as contactSensor or motionSensor."),
    referenceQueryParameter("actionCapabilities", "Comma-separated action capability IDs such as switch or colorControl."),
    referenceQueryParameter("conditions", "Comma-separated conditions such as equals, changes, remains, or lessThan."),
    referenceQueryParameter("operands", "Comma-separated operand kinds such as device, string, datetime, specific, trigger, or integer."),
    referenceQueryParameter("commands", "Comma-separated command names such as on, off, lock, or setColor."),
    referenceQueryParameter("tags", "Comma-separated catalog tags."),
    {
      name: "limit",
      in: "query",
      required: false,
      schema: { type: "integer", minimum: 1, maximum: 10 },
      description: "Maximum number of reference candidates to return."
    }
  ];
}

function referenceQueryParameter(name: string, description: string) {
  return {
    name,
    in: "query",
    required: false,
    schema: { type: "string" },
    description
  };
}

function ruleReferenceBaseProperties() {
  return {
    id: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    sourceName: { type: "string" },
    sourceUrl: { type: "string" },
    sourceExamplePath: { type: "string" },
    patternKind: { type: "string", enum: ["official", "derived"] },
    tags: stringArraySchema(),
    aliases: stringArraySchema(),
    constructs: stringArraySchema(),
    triggerCapabilities: stringArraySchema(),
    actionCapabilities: stringArraySchema(),
    conditions: stringArraySchema(),
    operands: stringArraySchema(),
    commands: stringArraySchema(),
    requiredContext: stringArraySchema()
  };
}

function ruleReferenceSearchResultSchema() {
  return {
    type: "object",
    required: [
      "id",
      "title",
      "summary",
      "sourceName",
      "sourceUrl",
      "sourceExamplePath",
      "patternKind",
      "tags",
      "aliases",
      "constructs",
      "triggerCapabilities",
      "actionCapabilities",
      "conditions",
      "operands",
      "commands",
      "requiredContext",
      "score",
      "matchedFields",
      "matchReason"
    ],
    properties: {
      ...ruleReferenceBaseProperties(),
      score: { type: "integer" },
      matchedFields: stringArraySchema(),
      matchReason: { type: "string" }
    }
  };
}

function ruleReferenceSchema() {
  return {
    type: "object",
    required: [
      "id",
      "title",
      "summary",
      "sourceName",
      "sourceUrl",
      "sourceExamplePath",
      "patternKind",
      "tags",
      "aliases",
      "constructs",
      "triggerCapabilities",
      "actionCapabilities",
      "conditions",
      "operands",
      "commands",
      "requiredContext",
      "mappingNotes",
      "example"
    ],
    properties: {
      ...ruleReferenceBaseProperties(),
      mappingNotes: stringArraySchema(),
      example: {
        type: "object",
        additionalProperties: true
      }
    }
  };
}

function stringArraySchema() {
  return {
    type: "array",
    items: { type: "string" }
  };
}
