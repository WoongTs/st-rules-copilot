import { z } from "zod";
import { mcpServerInstructions, mcpOnlyToolNames, mcpOnlyToolDescriptions } from "./ai-instructions";
import {
  capabilityContextResultParts,
  connectedStatusResultParts,
  createRuleExecutionResultParts,
  deleteRuleExecutionResultParts,
  deviceListResultParts,
  locationResultParts,
  referenceCheckResultParts,
  ruleDetailResultParts,
  ruleReferenceDetailResultParts,
  ruleReferenceSearchResultParts,
  rulesListResultParts,
  setRuleStatusExecutionResultParts,
  updateRuleExecutionResultParts,
  type FlowToolNames
} from "./flow-guidance";
import { inspectCapabilityContextInputSchema } from "./capability-context";
import { AppError } from "./errors";
import { compactDevicesForAi } from "./device-output";
import { maybeConnection, reconnectUrlForConnection, patRecoveryErrorBody, withRuleWriteRecovery } from "./http-utils";
import { RECONNECT_TICKET_TTL_SECONDS } from "./reconnect-ticket-store";
import { getRuleReference, searchRuleReferences } from "./rule-references";
import { SmartThingsService } from "./service";
import {
  createRuleConfirmedSchema,
  deleteRuleConfirmedSchema,
  locationIdSchema,
  optionalLocationIdSchema,
  ruleIdSchema,
  ruleJsonReferenceCheckSchema,
  setRuleStatusConfirmedSchema,
  toolDescriptions,
  toolNames,
  updateRuleConfirmedSchema
} from "./tool-contracts";
import type { Env } from "./types";
import type { McpServer as McpServerInstance } from "@modelcontextprotocol/sdk/server/mcp.js";

type McpServerConstructor = new (
  ...args: ConstructorParameters<
    typeof import("@modelcontextprotocol/sdk/server/mcp.js").McpServer
  >
) => McpServerInstance;

const mcpToolNames: FlowToolNames = {
  listLocations: toolNames.listLocations,
  listDevices: toolNames.listDevices,
  inspectCapabilityContext: toolNames.inspectCapabilityContext,
  searchRuleReferences: toolNames.searchRuleReferences,
  getRuleReference: toolNames.getRuleReference,
  checkRuleJsonReferences: toolNames.checkRuleJsonReferences
};

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true
};

export async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const [{ createMcpHandler }, { McpServer }] = await Promise.all([
    import("agents/mcp"),
    import("@modelcontextprotocol/sdk/server/mcp.js")
  ]);
  const connectionId = await maybeConnection(request, env);
  const server = createServer(McpServer, env, request, connectionId);
  return createMcpHandler(server)(request, env, ctx);
}

function createServer(
  McpServer: McpServerConstructor,
  env: Env,
  request: Request,
  connectionId: string | null
): McpServerInstance {
  const server = new McpServer({
    name: "smartthings-rules-copilot",
    version: "0.1.0"
  }, {
    instructions: mcpServerInstructions,
    maxToolInputElements: 10000
  });

  const guarded = <Args extends unknown[]>(
    callback: (...args: Args) => Promise<McpToolResult>
  ) => async (...args: Args): Promise<McpToolResult> => {
    try {
      return await callback(...args);
    } catch (error) {
      if (error instanceof AppError) {
        return appErrorToolResult(error, request, env, connectionId);
      }
      throw error;
    }
  };

  server.registerTool(
    toolNames.getStatus,
    {
      description: toolDescriptions.getStatus,
      inputSchema: {},
      annotations: readOnlyAnnotations
    },
    guarded(async () => {
      if (!connectionId) {
        return patExpiredToolResult(request, env, connectionId);
      }

      const service = new SmartThingsService(env);
      const status = await service.status(connectionId);
      if (!status.connected) {
        return patExpiredToolResult(request, env, connectionId);
      }

      const parts = connectedStatusResultParts(mcpToolNames);
      return toolResult(parts.text, {
        ok: true,
        ...status,
        ...(parts.guidance ? { guidance: parts.guidance } : {}),
        connected: true
      });
    })
  );

  server.registerTool(
    mcpOnlyToolNames.getReconnectLink,
    {
      description: mcpOnlyToolDescriptions.getReconnectLink,
      inputSchema: {},
      annotations: { ...readOnlyAnnotations, idempotentHint: false, openWorldHint: false }
    },
    guarded(async () => {
      const reconnectUrl = await reconnectUrlForConnection(
        request,
        env,
        requireConnection(connectionId)
      );
      const messageForUser = "이 AI 연결에 새 PAT를 저장하는 링크입니다. 10분 안에 웹에서 입력한 뒤 대화로 돌아오세요.";
      return toolResult(`${messageForUser}\n${reconnectUrl}`, {
        ok: true,
        messageForUser,
        reconnectUrl,
        expiresInSeconds: RECONNECT_TICKET_TTL_SECONDS
      });
    })
  );

  server.registerTool(
    toolNames.listLocations,
    {
      description: toolDescriptions.listLocations,
      inputSchema: {},
      annotations: readOnlyAnnotations
    },
    guarded(async () => {
      const service = new SmartThingsService(env);
      const locations = await service.listLocations(requireConnection(connectionId));
      const parts = locationResultParts(locations, mcpToolNames);
      return toolResult(parts.text, {
        ok: true,
        ...(parts.guidance ? { guidance: parts.guidance } : {}),
        locations
      });
    })
  );

  server.registerTool(
    toolNames.listDevices,
    {
      description: toolDescriptions.listDevices,
      inputSchema: {
        locationId: optionalLocationIdSchema
      },
      annotations: readOnlyAnnotations
    },
    guarded(async ({ locationId }: { locationId?: string }) => {
      const service = new SmartThingsService(env);
      const devices = await service.listDevices(requireConnection(connectionId), locationId);
      const devicesForAi = compactDevicesForAi(devices);
      const parts = deviceListResultParts(mcpToolNames);
      return toolResult(`${devices.length}개 기기를 찾았습니다. ${parts.text}`, {
        ok: true,
        ...(parts.guidance ? { guidance: parts.guidance } : {}),
        devices: devicesForAi
      });
    })
  );

  server.registerTool(
    toolNames.listRules,
    {
      description: toolDescriptions.listRules,
      inputSchema: { locationId: locationIdSchema },
      annotations: readOnlyAnnotations
    },
    guarded(async ({ locationId }: { locationId: string }) => {
      const service = new SmartThingsService(env);
      const rules = await service.listRules(requireConnection(connectionId), locationId);
      const parts = rulesListResultParts();
      return toolResult(`${rules.length}개 Rule을 찾았습니다. ${parts.text}`, {
        ok: true,
        ...(parts.guidance ? { guidance: parts.guidance } : {}),
        rules
      });
    })
  );

  server.registerTool(
    toolNames.inspectCapabilityContext,
    {
      description: toolDescriptions.inspectCapabilityContext,
      inputSchema: {
        locationId: inspectCapabilityContextInputSchema.shape.locationId.describe(
          "SmartThings location ID returned by listLocations."
        ),
        targets: inspectCapabilityContextInputSchema.shape.targets.describe(
          "Confirmed device/component/capability targets. Maximum 10."
        ),
        include: inspectCapabilityContextInputSchema.shape.include.describe(
          "Optional include flags. Defaults to definition=true, deviceStatus=true, presentation=false."
        ),
        presentationMode:
          inspectCapabilityContextInputSchema.shape.presentationMode.describe(
            "none or automationOnly. Default is none; presentation=true defaults to automationOnly."
          )
      },
      annotations: readOnlyAnnotations
    },
    guarded(async (input: unknown) => {
      const parsed = inspectCapabilityContextInputSchema.parse(input);
      const service = new SmartThingsService(env);
      const result = await service.inspectCapabilityContext(
        requireConnection(connectionId),
        parsed
      );
      const parts = capabilityContextResultParts(mcpToolNames);
      return toolResult(parts.text, {
        ok: true,
        contexts: result.contexts,
        ...(parts.guidance ? { guidance: parts.guidance } : {})
      });
    })
  );

  server.registerTool(
    toolNames.getRuleDetail,
    {
      description: toolDescriptions.getRuleDetail,
      inputSchema: {
        locationId: locationIdSchema,
        ruleId: ruleIdSchema
      },
      annotations: readOnlyAnnotations
    },
    guarded(async ({ locationId, ruleId }: { locationId: string; ruleId: string }) => {
      const service = new SmartThingsService(env);
      const rule = await service.getRuleDetail(
        requireConnection(connectionId),
        locationId,
        ruleId
      );
      const parts = ruleDetailResultParts(rule.name);
      return toolResult(parts.text, {
        ok: true,
        ...(parts.guidance ? { guidance: parts.guidance } : {}),
        rule
      });
    })
  );

  server.registerTool(
    toolNames.checkRuleJsonReferences,
    {
      description: toolDescriptions.checkRuleJsonReferences,
      inputSchema: {
        locationId: ruleJsonReferenceCheckSchema.shape.locationId,
        ruleJson: ruleJsonReferenceCheckSchema.shape.ruleJson
      },
      annotations: readOnlyAnnotations
    },
    guarded(async (input: {
      locationId: string;
      ruleJson: { name: string; actions: Record<string, unknown>[] } & Record<string, unknown>;
    }) => {
      const service = new SmartThingsService(env);
      const check = await service.checkRuleJsonReferences(
        requireConnection(connectionId),
        input
      );
      const parts = referenceCheckResultParts(check.referencesOk, mcpToolNames);
      const { messageForUser: _messageForUser, ...checkData } = check;
      return toolResult(parts.text, {
        ok: true,
        ...checkData,
        ...(parts.guidance ? { guidance: parts.guidance } : {})
      });
    })
  );

  server.registerTool(
    toolNames.createRuleConfirmed,
    {
      description: toolDescriptions.createRuleConfirmed,
      inputSchema: {
        locationId: createRuleConfirmedSchema.shape.locationId,
        ruleJson: createRuleConfirmedSchema.shape.ruleJson
      },
      annotations: destructiveAnnotations
    },
    guarded(async (input: z.infer<typeof createRuleConfirmedSchema>) => {
      const service = new SmartThingsService(env);
      const result = await withRuleWriteRecovery(
        await service.createRuleChatConfirmed(requireConnection(connectionId), input),
        request,
        env,
        connectionId
      );
      const parts = createRuleExecutionResultParts(result.executionStatus);
      const response = toolResult(
        [parts.text, result.messageForUser].filter(Boolean).join("\n\n"),
        { ...result }
      );
      return result.ok ? response : { ...response, isError: true };
    })
  );

  server.registerTool(
    toolNames.updateRuleConfirmed,
    {
      description: toolDescriptions.updateRuleConfirmed,
      inputSchema: {
        locationId: updateRuleConfirmedSchema.shape.locationId,
        ruleId: updateRuleConfirmedSchema.shape.ruleId,
        ruleJson: updateRuleConfirmedSchema.shape.ruleJson
      },
      annotations: destructiveAnnotations
    },
    guarded(async (input: z.infer<typeof updateRuleConfirmedSchema>) => {
      const service = new SmartThingsService(env);
      const result = await withRuleWriteRecovery(
        await service.updateRuleChatConfirmed(requireConnection(connectionId), input),
        request,
        env,
        connectionId
      );
      const parts = updateRuleExecutionResultParts(result.executionStatus);
      const response = toolResult(
        [parts.text, result.messageForUser].filter(Boolean).join("\n\n"),
        { ...result }
      );
      return result.ok ? response : { ...response, isError: true };
    })
  );

  server.registerTool(
    toolNames.deleteRuleConfirmed,
    {
      description: toolDescriptions.deleteRuleConfirmed,
      inputSchema: {
        locationId: deleteRuleConfirmedSchema.shape.locationId,
        ruleId: deleteRuleConfirmedSchema.shape.ruleId
      },
      annotations: destructiveAnnotations
    },
    guarded(async (input: z.infer<typeof deleteRuleConfirmedSchema>) => {
      const service = new SmartThingsService(env);
      const result = await withRuleWriteRecovery(
        await service.deleteRuleChatConfirmed(requireConnection(connectionId), input),
        request,
        env,
        connectionId
      );
      const parts = deleteRuleExecutionResultParts(result.executionStatus);
      const response = toolResult(
        [parts.text, result.messageForUser].filter(Boolean).join("\n\n"),
        { ...result }
      );
      return result.ok ? response : { ...response, isError: true };
    })
  );

  server.registerTool(
    toolNames.setRuleStatusConfirmed,
    {
      description: toolDescriptions.setRuleStatusConfirmed,
      inputSchema: {
        locationId: setRuleStatusConfirmedSchema.shape.locationId,
        ruleId: setRuleStatusConfirmedSchema.shape.ruleId,
        targetStatus: setRuleStatusConfirmedSchema.shape.targetStatus
      },
      annotations: destructiveAnnotations
    },
    guarded(async (input: z.infer<typeof setRuleStatusConfirmedSchema>) => {
      const service = new SmartThingsService(env);
      const result = await withRuleWriteRecovery(
        await service.setRuleStatusChatConfirmed(requireConnection(connectionId), input),
        request,
        env,
        connectionId
      );
      const parts = setRuleStatusExecutionResultParts(result.executionStatus);
      const response = toolResult(
        [parts.text, result.messageForUser].filter(Boolean).join("\n\n"),
        { ...result }
      );
      return result.ok ? response : { ...response, isError: true };
    })
  );

  server.registerTool(
    toolNames.searchRuleReferences,
    {
      description: toolDescriptions.searchRuleReferences,
      inputSchema: {
        query: z.string().trim().min(1).optional(),
        constructs: z.array(z.string().trim().min(1)).optional(),
        triggerCapabilities: z.array(z.string().trim().min(1)).optional(),
        actionCapabilities: z.array(z.string().trim().min(1)).optional(),
        conditions: z.array(z.string().trim().min(1)).optional(),
        operands: z.array(z.string().trim().min(1)).optional(),
        commands: z.array(z.string().trim().min(1)).optional(),
        tags: z.array(z.string().trim().min(1)).optional(),
        limit: z.number().int().min(1).max(10).optional()
      },
      annotations: { ...readOnlyAnnotations, openWorldHint: false }
    },
    guarded(async (filters: {
      query?: string;
      constructs?: string[];
      triggerCapabilities?: string[];
      actionCapabilities?: string[];
      conditions?: string[];
      operands?: string[];
      commands?: string[];
      tags?: string[];
      limit?: number;
    }) => {
      const references = searchRuleReferences(filters);
      const parts = ruleReferenceSearchResultParts();
      return toolResult(`${references.length}개 Rule 예시 참조를 찾았습니다. ${parts.text}`, {
        ok: true,
        ...(parts.guidance ? { guidance: parts.guidance } : {}),
        references
      });
    })
  );

  server.registerTool(
    toolNames.getRuleReference,
    {
      description: toolDescriptions.getRuleReference,
      inputSchema: { referenceId: z.string().trim().min(1) },
      annotations: { ...readOnlyAnnotations, openWorldHint: false }
    },
    guarded(async ({ referenceId }: { referenceId: string }) => {
      const reference = getRuleReference(referenceId);
      if (!reference) {
        return {
          ...toolResult("요청한 Rule 예시 참조를 찾을 수 없습니다.", {
            ok: false,
            code: "NOT_FOUND"
          }),
          isError: true
        };
      }

      const parts = ruleReferenceDetailResultParts();
      return toolResult(parts.text, {
        ok: true,
        ...(parts.guidance ? { guidance: parts.guidance } : {}),
        reference
      });
    })
  );

  return server;
}

function toolResult(text: string, structuredContent: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: `${text}\n\nstructuredContent:\n${JSON.stringify(structuredContent)}`
      }
    ],
    structuredContent
  };
}

type McpToolResult = ReturnType<typeof toolResult> & { isError?: boolean };

async function patExpiredToolResult(
  request: Request,
  env: Env,
  connectionId: string | null
): Promise<McpToolResult> {
  return appErrorToolResult(
    new AppError(
      "SMARTTHINGS_PAT_EXPIRED",
      401,
      "SmartThings 연결이 만료되었습니다. 웹앱에서 PAT를 다시 연결하세요."
    ),
    request,
    env,
    connectionId
  );
}

async function appErrorToolResult(
  error: AppError,
  request: Request,
  env: Env,
  connectionId: string | null
): Promise<McpToolResult> {
  const body = await patRecoveryErrorBody(error, request, env, connectionId);
  return {
    ...toolResult(body.messageForUser, { ...body }),
    isError: true
  };
}

function requireConnection(connectionId: string | null): string {
  if (!connectionId) {
    throw new AppError(
      "RECONNECT_UNAVAILABLE",
      401,
      "AI 연결을 확인할 수 없습니다. ChatGPT 또는 Claude의 연결 메뉴에서 다시 연결하세요."
    );
  }

  return connectionId;
}
