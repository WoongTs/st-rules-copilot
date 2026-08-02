import type { DeviceSummary } from "./types";

export interface CompactDeviceComponentSummary {
  componentId: string;
  capabilities: string[];
}

export interface CompactDeviceSummary {
  deviceId: string;
  label: string;
  roomName?: string;
  components: CompactDeviceComponentSummary[];
}

export function compactDevicesForAi(devices: DeviceSummary[]): CompactDeviceSummary[] {
  return devices.map((device) => compactDeviceForAi(device));
}

function compactDeviceForAi(device: DeviceSummary): CompactDeviceSummary {
  return {
    deviceId: device.deviceId,
    label: device.label,
    ...(device.roomName ? { roomName: device.roomName } : {}),
    components: componentsForAi(device)
  };
}

function componentsForAi(device: DeviceSummary): CompactDeviceComponentSummary[] {
  if (device.components && device.components.length > 0) {
    return device.components.map((component) => ({
      componentId: component.componentId,
      capabilities: component.capabilities
    }));
  }

  if (device.capabilities.length === 0) {
    return [];
  }

  return [
    {
      componentId: "main",
      capabilities: device.capabilities
    }
  ];
}
