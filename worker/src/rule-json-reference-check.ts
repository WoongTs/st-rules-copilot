import type { DeviceSummary, LocationSummary, SmartThingsRuleJson } from "./types";

type UnknownRecord = Record<string, unknown>;

export type RuleJsonCandidate = SmartThingsRuleJson;

export interface RuleJsonReferenceCheckInput {
  locationId: string;
  ruleJson: RuleJsonCandidate;
}

export interface RuleJsonReferenceCheckContext {
  locations: LocationSummary[];
  devices: DeviceSummary[];
}

export interface RuleJsonReferenceCheckResponse {
  messageForUser: string;
  referencesOk: boolean;
  errors: RuleJsonReferenceCheckIssue[];
}

export interface RuleJsonReferenceCheckIssue {
  code: string;
  message: string;
  path: string;
}

export interface RuleJsonReferenceScan {
  errors: RuleJsonReferenceCheckIssue[];
  locationReferences: LocationReference[];
  deviceReferences: DeviceReference[];
}

interface LocationReference {
  locationId: string;
  path: string;
}

interface DeviceReference {
  deviceIds: IndexedString[];
  deviceIdsPath: string;
  component?: string;
  componentPath: string;
  capability?: string;
  capabilityPath: string;
}

interface IndexedString {
  value: string;
  index: number;
}

const MAX_SCAN_NODES = 2000;
const MAX_REFERENCES = 200;

export function scanRuleJsonReferences(
  input: RuleJsonReferenceCheckInput
): RuleJsonReferenceScan {
  const scan: RuleJsonReferenceScan = {
    errors: [],
    locationReferences: [],
    deviceReferences: []
  };

  const ruleLocationId = input.ruleJson.locationId;
  if (typeof ruleLocationId === "string" && ruleLocationId !== input.locationId) {
    scan.errors.push({
      code: "LOCATION_MISMATCH",
      message: "Rule JSON의 locationId가 요청 locationId와 다릅니다.",
      path: "$.ruleJson.locationId"
    });
  }

  if (ruleLocationId !== undefined && typeof ruleLocationId !== "string") {
    scan.errors.push({
      code: "RULE_LOCATION_ID_NOT_STRING",
      message: "Rule JSON의 locationId가 있으면 string이어야 합니다.",
      path: "$.ruleJson.locationId"
    });
  }

  const stack: Array<{ value: unknown; path: string }> = [
    { value: input.ruleJson, path: "$.ruleJson" }
  ];
  let visited = 0;
  let limitReported = false;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    visited += 1;
    if (visited > MAX_SCAN_NODES) {
      scan.errors.push({
        code: "REFERENCE_CHECK_LIMIT_EXCEEDED",
        message: "Rule JSON이 너무 커서 참조 무결성 점검을 중단했습니다.",
        path: current.path
      });
      break;
    }

    const { value, path } = current;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], path: `${path}[${index}]` });
      }
      continue;
    }

    if (!isRecord(value)) {
      continue;
    }

    if (isRecord(value.device)) {
      collectDeviceOperand(value.device, `${path}.device`, scan);
      limitReported = stopIfReferenceLimitReached(scan, path, limitReported);
      if (limitReported) {
        break;
      }
    }

    if (isRecord(value.location)) {
      collectLocationOperand(value.location, `${path}.location`, scan);
    }

    if (isRecord(value.command)) {
      collectCommandAction(value.command, `${path}.command`, scan);
      limitReported = stopIfReferenceLimitReached(scan, path, limitReported);
      if (limitReported) {
        break;
      }
    }

    const entries = Object.entries(value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      stack.push({ value: child, path: pathForKey(path, key) });
    }
  }

  return scan;
}

export function buildRuleJsonReferenceCheckResponse(
  input: RuleJsonReferenceCheckInput,
  scan: RuleJsonReferenceScan,
  context: RuleJsonReferenceCheckContext
): RuleJsonReferenceCheckResponse {
  const errors = checkReferences(input, scan, context);
  const referencesOk = errors.length === 0;

  return {
    messageForUser: referencesOk
      ? "Rule JSON의 location/device/component/capability 참조 1차 점검을 통과했습니다. 아직 SmartThings Rule은 생성되지 않았습니다."
      : "Rule JSON에서 현재 SmartThings 연결 정보와 맞지 않는 참조 오류를 찾았습니다.",
    referencesOk,
    errors
  };
}

function collectDeviceOperand(
  deviceOperand: UnknownRecord,
  path: string,
  scan: RuleJsonReferenceScan
): void {
  const deviceIds = indexedStringsFrom(deviceOperand.devices);
  const component = stringValue(deviceOperand.component);
  const capability = stringValue(deviceOperand.capability);

  if (deviceIds.length === 0) {
    scan.errors.push({
      code: "DEVICE_REFERENCE_REQUIRED",
      message: "device operand에는 하나 이상의 devices 항목이 필요합니다.",
      path: `${path}.devices`
    });
  }

  if (!component) {
    scan.errors.push({
      code: "DEVICE_COMPONENT_REQUIRED",
      message: "device operand에는 component가 필요합니다.",
      path: `${path}.component`
    });
  }

  if (!capability) {
    scan.errors.push({
      code: "DEVICE_CAPABILITY_REQUIRED",
      message: "device operand에는 capability가 필요합니다.",
      path: `${path}.capability`
    });
  }

  if (deviceIds.length > 0) {
    scan.deviceReferences.push({
      deviceIds,
      deviceIdsPath: `${path}.devices`,
      component,
      componentPath: `${path}.component`,
      capability,
      capabilityPath: `${path}.capability`
    });
  }
}

function collectLocationOperand(
  locationOperand: UnknownRecord,
  path: string,
  scan: RuleJsonReferenceScan
): void {
  const locationId = stringValue(locationOperand.locationId);
  if (locationId) {
    scan.locationReferences.push({ locationId, path: `${path}.locationId` });
  }
}

function collectCommandAction(
  commandAction: UnknownRecord,
  path: string,
  scan: RuleJsonReferenceScan
): void {
  const deviceIds = indexedStringsFrom(commandAction.devices);
  if (deviceIds.length === 0) {
    scan.errors.push({
      code: "COMMAND_DEVICES_REQUIRED",
      message: "command action에는 하나 이상의 devices 항목이 필요합니다.",
      path: `${path}.devices`
    });
  }

  const commands = Array.isArray(commandAction.commands) ? commandAction.commands : [];
  if (commands.length === 0) {
    scan.errors.push({
      code: "COMMANDS_REQUIRED",
      message: "command action에는 하나 이상의 commands 항목이 필요합니다.",
      path: `${path}.commands`
    });
  }

  commands.forEach((command, index) => {
    const commandPath = `${path}.commands[${index}]`;
    if (!isRecord(command)) {
      scan.errors.push({
        code: "COMMAND_NOT_OBJECT",
        message: "commands 항목은 object여야 합니다.",
        path: commandPath
      });
      return;
    }

    const commandComponent = stringValue(command.component);
    const actionComponent = stringValue(commandAction.component);
    const component = commandComponent ?? actionComponent;
    const componentPath = commandComponent ? `${commandPath}.component` : `${path}.component`;
    const capability = stringValue(command.capability);
    const commandName = stringValue(command.command);

    if (!component) {
      scan.errors.push({
        code: "COMMAND_COMPONENT_REQUIRED",
        message: "command에는 component가 필요합니다.",
        path: `${commandPath}.component`
      });
    }

    if (!capability) {
      scan.errors.push({
        code: "COMMAND_CAPABILITY_REQUIRED",
        message: "command에는 capability가 필요합니다.",
        path: `${commandPath}.capability`
      });
    }

    if (!commandName) {
      scan.errors.push({
        code: "COMMAND_NAME_REQUIRED",
        message: "command에는 command 이름이 필요합니다.",
        path: `${commandPath}.command`
      });
    }

    if (deviceIds.length > 0) {
      scan.deviceReferences.push({
        deviceIds,
        deviceIdsPath: `${path}.devices`,
        component,
        componentPath,
        capability,
        capabilityPath: `${commandPath}.capability`
      });
    }
  });
}

function checkReferences(
  input: RuleJsonReferenceCheckInput,
  scan: RuleJsonReferenceScan,
  context: RuleJsonReferenceCheckContext
): RuleJsonReferenceCheckIssue[] {
  const errors = [...scan.errors];
  const locationIds = new Set(context.locations.map((location) => location.locationId));

  if (!locationIds.has(input.locationId)) {
    errors.push({
      code: "UNKNOWN_LOCATION",
      message: "locationId가 현재 SmartThings 연결의 위치 목록에 없습니다.",
      path: "$.locationId"
    });
  }

  for (const reference of scan.locationReferences) {
    if (reference.locationId !== input.locationId) {
      errors.push({
        code: "LOCATION_MISMATCH",
        message: "location operand의 locationId가 요청 locationId와 다릅니다.",
        path: reference.path
      });
    }
  }

  const deviceIndex = new Map(context.devices.map((device) => [device.deviceId, device]));
  for (const reference of scan.deviceReferences) {
    for (const deviceId of reference.deviceIds) {
      validateDeviceReference(deviceId, reference, deviceIndex, errors);
    }
  }

  return errors;
}

function validateDeviceReference(
  deviceId: IndexedString,
  reference: DeviceReference,
  deviceIndex: Map<string, DeviceSummary>,
  errors: RuleJsonReferenceCheckIssue[]
): void {
  const device = deviceIndex.get(deviceId.value);
  if (!device) {
    errors.push({
      code: "UNKNOWN_DEVICE",
      message: `deviceId '${deviceId.value}'를 현재 location의 SmartThings 기기 목록에서 찾지 못했습니다.`,
      path: `${reference.deviceIdsPath}[${deviceId.index}]`
    });
    return;
  }

  if (!reference.component || !reference.capability) {
    return;
  }

  const components = componentsFor(device);
  const matchingComponent = components.find(
    (component) => component.componentId === reference.component
  );

  if (!matchingComponent) {
    errors.push({
      code: "DEVICE_COMPONENT_MISSING",
      message: `${device.label}에서 component '${reference.component}'를 찾지 못했습니다. 사용 가능한 component: ${components.map((component) => component.componentId).join(", ") || "없음"}.`,
      path: reference.componentPath
    });
    return;
  }

  if (!matchingComponent.capabilities.includes(reference.capability)) {
    errors.push({
      code: "DEVICE_CAPABILITY_MISSING",
      message: `${device.label}의 component '${matchingComponent.componentId}'에 capability '${reference.capability}'가 없습니다. 사용 가능한 capability: ${matchingComponent.capabilities.join(", ") || "없음"}.`,
      path: reference.capabilityPath
    });
  }
}

function componentsFor(device: DeviceSummary): Array<{
  componentId: string;
  capabilities: string[];
}> {
  if (device.components?.length) {
    return device.components;
  }

  return [{ componentId: "main", capabilities: device.capabilities }];
}

function stopIfReferenceLimitReached(
  scan: RuleJsonReferenceScan,
  path: string,
  alreadyReported: boolean
): boolean {
  if (scan.deviceReferences.length + scan.locationReferences.length <= MAX_REFERENCES) {
    return false;
  }

  if (!alreadyReported) {
    scan.errors.push({
      code: "REFERENCE_CHECK_LIMIT_EXCEEDED",
      message: "Rule JSON의 참조가 너무 많아 참조 무결성 점검을 중단했습니다.",
      path
    });
  }

  return true;
}

function indexedStringsFrom(value: unknown): IndexedString[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) =>
    typeof item === "string" && item.trim().length > 0
      ? [{ value: item.trim(), index }]
      : []
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pathForKey(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}
