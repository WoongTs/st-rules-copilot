import { SmartThingsClient } from "./smartthings";
import { AppError } from "./errors";
import { enforceSideEffectRateLimit } from "./request-security";
import { TokenStore } from "./token-store";
import {
  duplicateRuleGuidance,
  repairedDraftGuidance,
  writeResultGuidance
} from "./ai-instructions";
import {
  buildRuleJsonReferenceCheckResponse,
  scanRuleJsonReferences,
  type RuleJsonReferenceCheckInput,
  type RuleJsonReferenceCheckResponse
} from "./rule-json-reference-check";
import {
  capabilityContextOptions,
  emptyNormalizedCapabilityContext,
  normalizeCapabilityContext,
  trimCapabilityPresentation,
  type CapabilityContext,
  type CapabilityContextResponse,
  type CapabilityContextWarning,
  type InspectCapabilityContextInput
} from "./capability-context";
import type {
  ConnectionStatusSummary,
  ConnectionReadSummary,
  DeviceComponentSummary,
  DeviceSummary,
  Env,
  LocationSummary,
  RuleDetail,
  RuleSummary,
  SmartThingsRawResponse,
  SmartThingsRuleJson,
  RuleTargetStatus,
  ToolGuidance
} from "./types";

export interface CreateRuleChatConfirmedInput {
  locationId: string;
  ruleJson: SmartThingsRuleJson;
}

export interface DeleteRuleChatConfirmedInput {
  locationId: string;
  ruleId: string;
}

export interface UpdateRuleChatConfirmedInput {
  locationId: string;
  ruleId: string;
  ruleJson: SmartThingsRuleJson;
}

export interface SetRuleStatusChatConfirmedInput {
  locationId: string;
  ruleId: string;
  targetStatus: RuleTargetStatus;
}

export interface SmartThingsWriteRequest {
  method: "POST" | "PUT" | "DELETE";
  path: string;
  query: Record<string, string>;
  body: unknown | null;
}

export interface SmartThingsWriteReadback {
  confirmed: boolean;
  status: number;
  body: unknown;
}

export interface RuleWriteError {
  code: string;
  message: string;
}

export type RuleWriteExecutionStatus =
  | "created"
  | "create_not_confirmed"
  | "duplicate_name"
  | "updated"
  | "update_not_confirmed"
  | "deleted"
  | "delete_not_confirmed"
  | "enabled"
  | "disabled"
  | "already_enabled"
  | "already_disabled"
  | "rejected_by_smartthings"
  | "status_not_confirmed";

export interface RuleWriteResult {
  ok: boolean;
  executionStatus: RuleWriteExecutionStatus;
  before?: RuleDetail;
  request: SmartThingsWriteRequest | null;
  response: SmartThingsRawResponse | null;
  readback: SmartThingsWriteReadback | null;
  error?: RuleWriteError;
  guidance?: ToolGuidance;
  duplicateRule?: RuleSummary;
}

export type CreateRuleChatConfirmedResult = RuleWriteResult;
export type UpdateRuleChatConfirmedResult = RuleWriteResult;
export type DeleteRuleChatConfirmedResult = RuleWriteResult;
export type SetRuleStatusChatConfirmedResult = RuleWriteResult;

export class SmartThingsService {
  private readonly tokenStore: TokenStore;

  constructor(private readonly env: Env) {
    this.tokenStore = new TokenStore(env);
  }

  async connect(connectionId: string, pat: string): Promise<ConnectionReadSummary> {
    const readSummary = await this.readAllWithPat(pat, new Date().toISOString());
    const saved = await this.tokenStore.savePat(connectionId, pat);
    return {
      ...readSummary,
      expiresAt: saved.expiresAt
    };
  }

  async reconnect(
    connectionId: string,
    nonce: string,
    pat: string
  ): Promise<ConnectionReadSummary> {
    const readSummary = await this.readAllWithPat(pat, new Date().toISOString());
    const saved = await this.tokenStore.consumeReconnectAndSavePat(
      connectionId,
      nonce,
      pat
    );
    return {
      ...readSummary,
      expiresAt: saved.expiresAt
    };
  }

  async status(connectionId: string): Promise<ConnectionStatusSummary> {
    const record = await this.tokenStore.getPat(connectionId);
    if (!record) {
      return { connected: false };
    }

    const client = new SmartThingsClient(this.env, record.pat);
    const locations = await client.listLocations();
    return {
      connected: true,
      expiresAt: record.expiresAt,
      locationsCount: locations.length
    };
  }

  async listLocations(connectionId: string): Promise<LocationSummary[]> {
    const client = await this.clientFor(connectionId);
    return client.listLocations();
  }

  async listDevices(connectionId: string, locationId?: string): Promise<DeviceSummary[]> {
    const client = await this.clientFor(connectionId);
    return client.listDevices(locationId);
  }

  async listRules(connectionId: string, locationId: string): Promise<RuleSummary[]> {
    const client = await this.clientFor(connectionId);
    return client.listRules(locationId);
  }

  async getRuleDetail(
    connectionId: string,
    locationId: string,
    ruleId: string
  ): Promise<RuleDetail> {
    const client = await this.clientFor(connectionId);
    return client.getRuleDetail(locationId, ruleId);
  }

  async checkRuleJsonReferences(
    connectionId: string,
    input: RuleJsonReferenceCheckInput
  ): Promise<RuleJsonReferenceCheckResponse> {
    const scan = scanRuleJsonReferences(input);
    const context = await this.ruleJsonReferenceCheckContext(
      connectionId,
      input.locationId,
      scan.deviceReferences.length > 0
    );
    return buildRuleJsonReferenceCheckResponse(input, scan, context);
  }

  async createRuleChatConfirmed(
    connectionId: string,
    input: CreateRuleChatConfirmedInput
  ): Promise<CreateRuleChatConfirmedResult> {
    await enforceSideEffectRateLimit(this.env, connectionId);
    const client = await this.clientFor(connectionId);
    const existingRules = await client.listRules(input.locationId);
    const duplicateRule = existingRules.find(
      (rule) =>
        normalizeRuleName(rule.name) === normalizeRuleName(input.ruleJson.name)
    );
    if (duplicateRule) {
      return {
        ok: false,
        executionStatus: "duplicate_name",
        duplicateRule,
        request: null,
        response: null,
        readback: null,
        error: {
          code: "DUPLICATE_RULE_NAME",
          message: "같은 이름의 Rule이 이미 있어 생성 요청을 보내지 않았습니다."
        },
        guidance: {
          instructions: duplicateRuleGuidance(
            "A Rule with the same normalized name already exists, so no create request was sent."
          ),
          next: {
            step: "show_checked_draft",
            reason:
              "Ask the user whether to keep the existing Rule, rename the draft, or delete the existing Rule first."
          }
        }
      };
    }

    const request = writeRequest("POST", "/rules", input.locationId, input.ruleJson);
    const response = await client.createRule(
      input.locationId,
      input.ruleJson
    );
    if (!isSuccessfulResponse(response)) {
      return {
        ok: false,
        executionStatus: "rejected_by_smartthings",
        request,
        response,
        readback: null,
        error: smartThingsRejectedError("create", response.status),
        guidance: draftRuleJsonGuidance(
          "SmartThings rejected the create request. Fix the JSON, then run reference check again."
        )
      };
    }

    const ruleId = ruleIdFromCreateResponse(response.body);
    if (!ruleId) {
      return {
        ok: false,
        executionStatus: "create_not_confirmed",
        request,
        response,
        readback: null,
        error: {
          code: "CREATE_RULE_ID_MISSING",
          message: "SmartThings 생성 응답에서 ruleId를 확인하지 못해 readback을 수행할 수 없습니다."
        },
        guidance: {
          instructions: writeResultGuidance(
            "The create response did not include a Rule ID, so same-PAT readback could not run.",
            "Do not report creation because readback.confirmed is not true."
          )
        }
      };
    }

    const readbackResponse = await client.getRuleDetailRaw(input.locationId, ruleId);
    const readback = writeReadback(
      readbackResponse,
      isSuccessfulResponse(readbackResponse) &&
        ruleIdFromCreateResponse(readbackResponse.body) === ruleId
    );
    if (!readback.confirmed) {
      return {
        ok: false,
        executionStatus: "create_not_confirmed",
        request,
        response,
        readback,
        error: readbackNotConfirmedError("created Rule"),
        guidance: {
          instructions: writeResultGuidance(
            "The create request returned success, but same-PAT detail readback did not confirm the Rule.",
            "Do not report creation because readback.confirmed is false."
          )
        }
      };
    }

    await incrementRulesCreatedTotal(this.env.APP_KV);

    return {
      ok: true,
      executionStatus: "created",
      request,
      response,
      readback
    };
  }

  async deleteRuleChatConfirmed(
    connectionId: string,
    input: DeleteRuleChatConfirmedInput
  ): Promise<DeleteRuleChatConfirmedResult> {
    await enforceSideEffectRateLimit(this.env, connectionId);
    const client = await this.clientFor(connectionId);
    const before = await client.getRuleDetail(
      input.locationId,
      input.ruleId
    );
    const request = writeRequest("DELETE", `/rules/${encodeURIComponent(input.ruleId)}`, input.locationId);
    const response = await client.deleteRule(
      input.locationId,
      input.ruleId
    );
    const readbackResponse = await client.getRuleDetailRaw(input.locationId, input.ruleId);
    let readback = writeReadback(readbackResponse, readbackResponse.status === 404);

    if (isSuccessfulResponse(response) && readbackResponse.status === 403) {
      try {
        const rules = await client.listRules(input.locationId);
        const rulePresent = rules.some((rule) => rule.id === input.ruleId);
        readback = {
          confirmed: !rulePresent,
          status: readbackResponse.status,
          body: {
            detail: readbackResponse.body,
            listReadback: {
              rulePresent
            }
          }
        };
      } catch {
        // Keep the unconfirmed detail readback when the same-PAT list fallback fails.
      }
    }

    if (!isSuccessfulResponse(response)) {
      return {
        ok: false,
        executionStatus: "rejected_by_smartthings",
        before,
        request,
        response,
        readback,
        error: smartThingsRejectedError("delete", response.status),
        guidance: deleteRuleGuidance(
          "SmartThings rejected the delete request. Report the raw response and same-PAT readback; do not claim deletion succeeded."
        )
      };
    }

    if (!readback.confirmed) {
      return {
        ok: false,
        executionStatus: "delete_not_confirmed",
        before,
        request,
        response,
        readback,
        error: readbackNotConfirmedError("deleted Rule"),
        guidance: deleteRuleGuidance(
          "The DELETE request returned success, but same-PAT detail/list readback did not confirm absence. Do not claim deletion succeeded."
        )
      };
    }

    return {
      ok: true,
      executionStatus: "deleted",
      before,
      request,
      response,
      readback
    };
  }

  async setRuleStatusChatConfirmed(
    connectionId: string,
    input: SetRuleStatusChatConfirmedInput
  ): Promise<SetRuleStatusChatConfirmedResult> {
    await enforceSideEffectRateLimit(this.env, connectionId);
    const client = await this.clientFor(connectionId);
    const before = await client.getRuleDetail(
      input.locationId,
      input.ruleId
    );
    const statusBefore = ruleStatus(before);

    if (statusBefore === input.targetStatus && isKnownRuleStatus(statusBefore)) {
      return {
        ok: true,
        executionStatus:
          input.targetStatus === "Enabled" ? "already_enabled" : "already_disabled",
        before,
        request: null,
        response: null,
        readback: {
          confirmed: true,
          status: 200,
          body: before
        }
      };
    }

    const operation = input.targetStatus === "Enabled" ? "enable" : "disable";
    const request = writeRequest(
      "PUT",
      `/rules/${encodeURIComponent(input.ruleId)}/status/${operation}`,
      input.locationId
    );
    const response = await client.setRuleStatus(
      input.locationId,
      input.ruleId,
      input.targetStatus
    );
    const readbackResponse = await client.getRuleDetailRaw(input.locationId, input.ruleId);
    const readback = writeReadback(
      readbackResponse,
      isSuccessfulResponse(readbackResponse) &&
        ruleStatus(readbackResponse.body) === input.targetStatus
    );

    if (!isSuccessfulResponse(response)) {
      return {
        ok: false,
        executionStatus: "rejected_by_smartthings",
        before,
        request,
        response,
        readback,
        error: smartThingsRejectedError("status", response.status),
        guidance: setRuleStatusGuidance(
          "SmartThings rejected the Rule status change request. Report the raw response and same-PAT readback; do not claim the status changed."
        )
      };
    }

    if (!readback.confirmed) {
      return {
        ok: false,
        executionStatus: "status_not_confirmed",
        before,
        request,
        response,
        readback,
        error: readbackNotConfirmedError("Rule status"),
        guidance: setRuleStatusGuidance(
          "The status change request returned success, but same-PAT readback did not confirm the target status. Do not claim the change succeeded."
        )
      };
    }

    return {
      ok: true,
      executionStatus: input.targetStatus === "Enabled" ? "enabled" : "disabled",
      before,
      request,
      response,
      readback
    };
  }

  async updateRuleChatConfirmed(
    connectionId: string,
    input: UpdateRuleChatConfirmedInput
  ): Promise<UpdateRuleChatConfirmedResult> {
    await enforceSideEffectRateLimit(this.env, connectionId);
    const client = await this.clientFor(connectionId);
    const before = await client.getRuleDetail(
      input.locationId,
      input.ruleId
    );
    const request = writeRequest(
      "PUT",
      `/rules/${encodeURIComponent(input.ruleId)}`,
      input.locationId,
      input.ruleJson
    );
    const response = await client.updateRule(
      input.locationId,
      input.ruleId,
      input.ruleJson
    );
    const readbackResponse = await client.getRuleDetailRaw(input.locationId, input.ruleId);
    const readback = writeReadback(
      readbackResponse,
      isSuccessfulResponse(readbackResponse) &&
        ruleRequestMatchesReadback(input.ruleJson, readbackResponse.body)
    );

    if (!isSuccessfulResponse(response)) {
      return {
        ok: false,
        executionStatus: "rejected_by_smartthings",
        before,
        request,
        response,
        readback,
        error: smartThingsRejectedError("update", response.status),
        guidance: draftRuleJsonGuidance(
          "SmartThings rejected the update request. Fix the full Rule JSON, then run reference check again."
        )
      };
    }

    if (!readback.confirmed) {
      return {
        ok: false,
        executionStatus: "update_not_confirmed",
        before,
        request,
        response,
        readback,
        error: readbackNotConfirmedError("updated Rule"),
        guidance: {
          instructions: writeResultGuidance(
            "The update request returned success, but same-PAT detail readback did not confirm the final Rule JSON.",
            "Do not report the update because readback.confirmed is false."
          )
        }
      };
    }

    return {
      ok: true,
      executionStatus: "updated",
      before,
      request,
      response,
      readback
    };
  }

  async inspectCapabilityContext(
    connectionId: string,
    input: InspectCapabilityContextInput
  ): Promise<CapabilityContextResponse> {
    const client = await this.clientFor(connectionId);
    const options = capabilityContextOptions(input);
    const locations = await client.listLocations();
    const locationExists = locations.some(
      (location) => location.locationId === input.locationId
    );

    if (!locationExists) {
      return {
        messageForUser:
          "요청한 locationId를 현재 SmartThings 연결에서 찾지 못했습니다.",
        contexts: input.targets.map((target, index) =>
          emptyCapabilityContext(target, target.capabilityVersion ?? 1, [
            {
              code: "UNKNOWN_LOCATION",
              message: "locationId가 현재 SmartThings 연결의 위치 목록에 없습니다.",
              path: `$.targets[${index}].locationId`
            }
          ])
        )
      };
    }

    const devices = await client.listDevices(input.locationId);
    const contexts = await Promise.all(
      input.targets.map(async (target, index) => {
        const device = devices.find((item) => item.deviceId === target.deviceId);
        if (!device) {
          return emptyCapabilityContext(target, target.capabilityVersion ?? 1, [
            {
              code: "UNKNOWN_DEVICE",
              message:
                "deviceId를 현재 location의 SmartThings 기기 목록에서 찾지 못했습니다.",
              path: `$.targets[${index}].deviceId`
            }
          ]);
        }

        const components = componentsFor(device);
        const component = components.find(
          (item) => item.componentId === target.componentId
        );
        if (!component) {
          return emptyCapabilityContext(target, target.capabilityVersion ?? 1, [
            {
              code: "DEVICE_COMPONENT_MISSING",
              message: `${device.label}에서 component '${target.componentId}'를 찾지 못했습니다.`,
              path: `$.targets[${index}].componentId`
            }
          ], device.label);
        }

        if (!component.capabilities.includes(target.capabilityId)) {
          return emptyCapabilityContext(target, target.capabilityVersion ?? 1, [
            {
              code: "DEVICE_CAPABILITY_MISSING",
              message: `${device.label}의 component '${component.componentId}'에 capability '${target.capabilityId}'가 없습니다.`,
              path: `$.targets[${index}].capabilityId`
            }
          ], device.label);
        }

        const capabilityVersion =
          target.capabilityVersion ??
          component.capabilityVersions?.[target.capabilityId] ??
          1;
        const warnings: CapabilityContextWarning[] = [];

        const [definition, deviceStatus, rawPresentation] = await Promise.all([
          options.include.definition
            ? this.tryCapabilityLookup(
                () =>
                  client.getCapabilityDefinition(
                    target.capabilityId,
                    capabilityVersion
                  ),
                "CAPABILITY_DEFINITION_UNAVAILABLE",
                `Capability definition lookup failed for ${target.capabilityId}/${capabilityVersion}.`
              )
            : null,
          options.include.deviceStatus
            ? this.tryCapabilityLookup(
                () =>
                  client.getDeviceCapabilityStatus(
                    target.deviceId,
                    target.componentId,
                    target.capabilityId
                  ),
                "DEVICE_CAPABILITY_STATUS_UNAVAILABLE",
                `Device capability status lookup failed for ${target.deviceId}/${target.componentId}/${target.capabilityId}.`
              )
            : null,
          options.include.presentation
            ? this.tryCapabilityLookup(
                () =>
                  client.getCapabilityPresentation(
                    target.capabilityId,
                    capabilityVersion
                  ),
                "CAPABILITY_PRESENTATION_UNAVAILABLE",
                `Capability presentation lookup failed for ${target.capabilityId}/${capabilityVersion}.`
              )
            : null
        ]);

        collectLookupWarning(definition, warnings);
        collectLookupWarning(deviceStatus, warnings);
        collectLookupWarning(rawPresentation, warnings);

        const definitionBody = lookupBody(definition);
        const deviceStatusBody = lookupBody(deviceStatus);
        const presentationBody = lookupBody(rawPresentation);
        const presentation = presentationBody
          ? trimCapabilityPresentation(presentationBody, options.presentationMode)
          : null;
        const normalized = normalizeCapabilityContext(
          definitionBody,
          deviceStatusBody,
          presentation
        );

        return {
          deviceId: target.deviceId,
          deviceLabel: device.label,
          componentId: target.componentId,
          capabilityId: target.capabilityId,
          capabilityVersion,
          definition: definitionBody,
          deviceStatus: deviceStatusBody,
          presentation,
          normalized: normalized.normalized,
          warnings: [...warnings, ...normalized.warnings]
        };
      })
    );

    return {
      messageForUser: `${contexts.length}개 capability context를 조회했습니다. 반환된 schema/status와 요청 시 presentation을 읽고 Rule JSON 값을 결정하세요.`,
      contexts
    };
  }

  async deletePat(connectionId: string): Promise<void> {
    await this.tokenStore.deletePat(connectionId);
  }

  async resetConnection(connectionId: string): Promise<void> {
    await this.tokenStore.reset(connectionId);
  }

  private async clientFor(connectionId: string): Promise<SmartThingsClient> {
    const record = await this.tokenStore.requirePat(connectionId);
    return new SmartThingsClient(this.env, record.pat);
  }

  private async ruleJsonReferenceCheckContext(
    connectionId: string,
    locationId: string,
    includeDevices: boolean
  ): Promise<{ locations: LocationSummary[]; devices: DeviceSummary[] }> {
    const client = await this.clientFor(connectionId);
    const locations = await client.listLocations();
    const locationExists = locations.some((location) => location.locationId === locationId);
    const devices =
      includeDevices && locationExists ? await client.listDevices(locationId) : [];
    return { locations, devices };
  }

  private async readAllWithPat(
    pat: string,
    expiresAt: string
  ): Promise<ConnectionReadSummary> {
    const client = new SmartThingsClient(this.env, pat);
    const locations = await client.listLocations();
    const devices = await client.listDevices();
    const rules = (
      await Promise.all(
        locations.map((location) => client.listRules(location.locationId))
      )
    ).flat();

    return {
      connected: true,
      expiresAt,
      locationsCount: locations.length,
      devicesCount: devices.length,
      rulesCount: rules.length,
      locations,
      devices,
      rules
    };
  }

  private async tryCapabilityLookup(
    lookup: () => Promise<Record<string, unknown>>,
    warningCode: string,
    warningMessage: string
  ): Promise<
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; warning: CapabilityContextWarning }
  > {
    try {
      return { ok: true, body: await lookup() };
    } catch {
      return {
        ok: false,
        warning: {
          code: warningCode,
          message: warningMessage
        }
      };
    }
  }
}

type CapabilityLookupResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; warning: CapabilityContextWarning }
  | null;

function collectLookupWarning(
  result: CapabilityLookupResult,
  warnings: CapabilityContextWarning[]
): void {
  if (result && !result.ok) {
    warnings.push(result.warning);
  }
}

function lookupBody(result: CapabilityLookupResult): Record<string, unknown> | null {
  return result?.ok ? result.body : null;
}

function emptyCapabilityContext(
  target: InspectCapabilityContextInput["targets"][number],
  capabilityVersion: number,
  warnings: CapabilityContextWarning[],
  deviceLabel?: string
): CapabilityContext {
  return {
    deviceId: target.deviceId,
    ...(deviceLabel ? { deviceLabel } : {}),
    componentId: target.componentId,
    capabilityId: target.capabilityId,
    capabilityVersion,
    definition: null,
    deviceStatus: null,
    presentation: null,
    normalized: emptyNormalizedCapabilityContext(),
    warnings
  };
}

function componentsFor(device: DeviceSummary): DeviceComponentSummary[] {
  if (device.components?.length) {
    return device.components;
  }

  return [{ componentId: "main", capabilities: device.capabilities }];
}

function normalizeRuleName(name: string): string {
  return name.trim().replace(/\s+/gu, " ").toLowerCase();
}

function draftRuleJsonGuidance(reason: string): ToolGuidance {
  return {
    instructions: repairedDraftGuidance(reason),
    next: {
      step: "draft_rule_json",
      tool: "checkRuleJsonReferences",
      reason
    }
  };
}

function deleteRuleGuidance(reason: string): ToolGuidance {
  return {
    instructions: writeResultGuidance(
      reason,
      "Only report deletion when readback.confirmed is true."
    )
  };
}

function setRuleStatusGuidance(reason: string): ToolGuidance {
  return {
    instructions: writeResultGuidance(
      reason,
      "Only report the target status when readback.confirmed is true."
    )
  };
}

function writeRequest(
  method: SmartThingsWriteRequest["method"],
  path: string,
  locationId: string,
  body: unknown | null = null
): SmartThingsWriteRequest {
  return {
    method,
    path,
    query: { locationId },
    body
  };
}

function writeReadback(
  response: SmartThingsRawResponse,
  confirmed: boolean
): SmartThingsWriteReadback {
  return {
    confirmed,
    status: response.status,
    body: response.body
  };
}

function isSuccessfulResponse(response: SmartThingsRawResponse): boolean {
  return response.status >= 200 && response.status < 300;
}

function smartThingsRejectedError(
  operation: string,
  status: number
): RuleWriteError {
  return {
    code: "SMARTTHINGS_WRITE_REJECTED",
    message: `SmartThings가 ${operation} 요청을 HTTP ${status}로 거부했습니다.`
  };
}

function readbackNotConfirmedError(target: string): RuleWriteError {
  return {
    code: "READBACK_NOT_CONFIRMED",
    message: `같은 PAT의 readback으로 ${target} 결과를 확인하지 못했습니다.`
  };
}

function ruleStatus(value: unknown): string | undefined {
  const rule = ruleRecord(value);
  return typeof rule.status === "string" && rule.status ? rule.status : undefined;
}

function isKnownRuleStatus(status: string | undefined): status is RuleTargetStatus {
  return status === "Enabled" || status === "Disabled";
}

function ruleRequestMatchesReadback(
  expected: SmartThingsRuleJson,
  body: unknown
): boolean {
  return jsonSubsetMatches(ruleRecord(body), expected);
}

function jsonSubsetMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => jsonSubsetMatches(actual[index], item))
    );
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) {
      return false;
    }
    return Object.entries(expected).every(([key, value]) =>
      jsonSubsetMatches(actual[key], value)
    );
  }
  return Object.is(actual, expected);
}

function ruleIdFromCreateResponse(body: unknown): string | null {
  const rule = ruleRecord(body);
  const id = rule.id ?? rule.ruleId;
  return typeof id === "string" && id ? id : null;
}

function ruleRecord(body: unknown): Record<string, unknown> {
  const bodyRecord = isRecord(body) ? body : {};
  return isRecord(bodyRecord.rule) ? bodyRecord.rule : bodyRecord;
}

async function incrementRulesCreatedTotal(store: KVNamespace): Promise<void> {
  try {
    const current = await store.get("metrics:rules_created:total");
    const currentCount =
      current && /^\d+$/u.test(current) ? Number(current) : 0;
    await store.put("metrics:rules_created:total", String(currentCount + 1));
  } catch {
    // Metrics must not affect the user-facing Rule creation result.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
