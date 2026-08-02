import type { CompactDeviceSummary } from "./device-output";
import {
  deviceListContinuationResultParts,
  deviceListResultParts,
  toolResult,
  type FlowToolNames
} from "./flow-guidance";
import type { ToolGuidance, ToolResultEnvelope } from "./types";

export const ACTION_DEVICE_RESPONSE_CHAR_BUDGET = 90_000;

export interface DeviceActionStructuredContent extends Record<string, unknown> {
  ok: true;
  guidance?: ToolGuidance;
  devices: CompactDeviceSummary[];
  totalCount: number;
  hasMore: boolean;
  nextCursor?: number;
}

export interface BuildActionDevicePageInput {
  devices: CompactDeviceSummary[];
  cursor: number;
  locationId?: string;
  toolNames: FlowToolNames;
}

export function buildActionDevicePage({
  devices,
  cursor,
  locationId,
  toolNames
}: BuildActionDevicePageInput): ToolResultEnvelope<DeviceActionStructuredContent> {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error("Device page cursor must be a non-negative safe integer.");
  }

  const sortedDevices = [...devices].sort((left, right) =>
    left.deviceId.localeCompare(right.deviceId)
  );
  const totalCount = sortedDevices.length;
  const start = Math.min(cursor, totalCount);

  if (start === totalCount) {
    return resultForPage([], totalCount, false, undefined, locationId, toolNames);
  }

  let pageDevices: CompactDeviceSummary[] = [];
  let fittingResult: ToolResultEnvelope<DeviceActionStructuredContent> | undefined;

  for (let index = start; index < totalCount; index += 1) {
    const candidateDevices = [...pageDevices, sortedDevices[index]];
    const nextCursor = index + 1;
    const hasMore = nextCursor < totalCount;
    const candidate = resultForPage(
      candidateDevices,
      totalCount,
      hasMore,
      hasMore ? nextCursor : undefined,
      locationId,
      toolNames
    );

    if (JSON.stringify(candidate).length > ACTION_DEVICE_RESPONSE_CHAR_BUDGET) {
      break;
    }

    pageDevices = candidateDevices;
    fittingResult = candidate;
  }

  if (!fittingResult) {
    throw new Error("A single compact device exceeds the GPT Actions response budget.");
  }

  return fittingResult;
}

function resultForPage(
  devices: CompactDeviceSummary[],
  totalCount: number,
  hasMore: boolean,
  nextCursor: number | undefined,
  locationId: string | undefined,
  toolNames: FlowToolNames
): ToolResultEnvelope<DeviceActionStructuredContent> {
  let parts;
  if (hasMore) {
    if (nextCursor === undefined) {
      throw new Error("A continuing GPT Actions device page requires nextCursor.");
    }
    parts = deviceListContinuationResultParts(toolNames, locationId, nextCursor);
  } else {
    parts = deviceListResultParts(toolNames);
  }
  const text = hasMore
    ? `전체 ${totalCount}개 기기 중 ${nextCursor}개까지 조회했습니다. ${parts.text}`
    : `${totalCount}개 기기를 모두 찾았습니다. ${parts.text}`;

  return toolResult(text, {
    ok: true,
    ...(parts.guidance ? { guidance: parts.guidance } : {}),
    devices,
    totalCount,
    hasMore,
    ...(nextCursor !== undefined ? { nextCursor } : {})
  });
}
