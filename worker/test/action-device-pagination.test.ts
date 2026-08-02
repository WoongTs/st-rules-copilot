import { describe, expect, it } from "vitest";
import {
  ACTION_DEVICE_RESPONSE_CHAR_BUDGET,
  buildActionDevicePage
} from "../src/action-device-pagination";
import { compactDevicesForAi, type CompactDeviceSummary } from "../src/device-output";
import type { FlowToolNames } from "../src/flow-guidance";
import type { DeviceSummary } from "../src/types";

const toolNames: FlowToolNames = {
  listLocations: "listLocations",
  listDevices: "listDevices",
  inspectCapabilityContext: "inspectCapabilityContext",
  searchRuleReferences: "searchRuleReferences",
  getRuleReference: "getRuleReference",
  checkRuleJsonReferences: "checkRuleJsonReferences"
};

describe("AI device output", () => {
  it("omits capability versions while preserving component capabilities", () => {
    const devices: DeviceSummary[] = [
      {
        deviceId: "dev-1",
        label: "거실등",
        roomName: "거실",
        capabilities: ["switch", "switchLevel"],
        components: [
          {
            componentId: "main",
            capabilities: ["switch", "switchLevel"],
            capabilityVersions: { switch: 1, switchLevel: 1 }
          }
        ]
      }
    ];

    expect(compactDevicesForAi(devices)).toEqual([
      {
        deviceId: "dev-1",
        label: "거실등",
        roomName: "거실",
        components: [
          {
            componentId: "main",
            capabilities: ["switch", "switchLevel"]
          }
        ]
      }
    ]);
  });
});

describe("GPT Actions device pagination", () => {
  it("keeps every page within the response budget and returns every device once", () => {
    const devices = Array.from({ length: 450 }, (_, index) =>
      compactDevice(449 - index)
    );
    const expectedIds = [...devices]
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId))
      .map((device) => device.deviceId);
    const returnedIds: string[] = [];
    let cursor = 0;
    let pageCount = 0;

    while (true) {
      const result = buildActionDevicePage({
        devices,
        cursor,
        locationId: "loc-1",
        toolNames
      });
      const page = result.structuredContent;

      expect(JSON.stringify(result).length).toBeLessThanOrEqual(
        ACTION_DEVICE_RESPONSE_CHAR_BUDGET
      );
      expect(page.totalCount).toBe(devices.length);
      returnedIds.push(...page.devices.map((device) => device.deviceId));
      pageCount += 1;

      if (!page.hasMore) {
        expect(page.nextCursor).toBeUndefined();
        expect(page.guidance?.next?.step).toBe("confirm_rule_targets");
        break;
      }

      expect(page.nextCursor).toBeGreaterThan(cursor);
      expect(page.guidance?.next).toMatchObject({
        step: "list_devices",
        tool: "listDevices",
        arguments: {
          locationId: "loc-1",
          cursor: page.nextCursor
        }
      });
      cursor = page.nextCursor as number;
    }

    expect(pageCount).toBeGreaterThan(1);
    expect(returnedIds).toEqual(expectedIds);
  });

  it("returns an empty final page for an empty list or a cursor past the end", () => {
    for (const input of [
      { devices: [] as CompactDeviceSummary[], cursor: 0 },
      { devices: [compactDevice(0)], cursor: 99 }
    ]) {
      const result = buildActionDevicePage({
        ...input,
        toolNames
      });

      expect(result.structuredContent).toMatchObject({
        devices: [],
        hasMore: false
      });
      expect(result.structuredContent.nextCursor).toBeUndefined();
    }
  });

  it("fails instead of repeating a cursor when one device exceeds the budget", () => {
    expect(() =>
      buildActionDevicePage({
        devices: [
          {
            ...compactDevice(0),
            label: "x".repeat(ACTION_DEVICE_RESPONSE_CHAR_BUDGET)
          }
        ],
        cursor: 0,
        toolNames
      })
    ).toThrow("single compact device");
  });
});

function compactDevice(index: number): CompactDeviceSummary {
  const capabilities = [
    "airConditionerMode",
    "battery",
    "colorControl",
    "colorTemperature",
    "contactSensor",
    "energyMeter",
    "healthCheck",
    "motionSensor",
    "powerMeter",
    "refresh",
    "relativeHumidityMeasurement",
    "switch",
    "switchLevel",
    "temperatureMeasurement",
    "thermostatMode"
  ];

  return {
    deviceId: `dev-${index.toString().padStart(4, "0")}`,
    label: `테스트 복합 기기 ${index}`,
    roomName: `방 ${Math.floor(index / 10)}`,
    components: [
      { componentId: "main", capabilities },
      { componentId: "sub", capabilities }
    ]
  };
}
