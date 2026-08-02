export interface ApiErrorBody {
  ok: false;
  code: string;
  messageForUser: string;
  reconnectUrl?: string;
}

export interface LocationSummary {
  locationId: string;
  name: string;
}

export interface DeviceSummary {
  deviceId: string;
  label: string;
  roomName?: string;
  capabilities: string[];
  components?: Array<{
    componentId: string;
    capabilities: string[];
  }>;
}

export interface RuleSummary {
  id: string;
  name: string;
  locationId: string;
}

export interface StatusBody {
  ok: true;
  connected: boolean;
  expiresAt?: string;
  locationsCount?: number;
}

export interface ConnectionBootstrapBody extends StatusBody {
  devicesCount?: number;
  rulesCount?: number;
  locations?: LocationSummary[];
  devices?: DeviceSummary[];
  rules?: RuleSummary[];
}

export interface LocationsBody {
  ok: true;
  locations: LocationSummary[];
}

export interface DevicesBody {
  ok: true;
  devices: DeviceSummary[];
}

export interface RulesBody {
  ok: true;
  rules: RuleSummary[];
}

export type LoadState = "idle" | "loading" | "ready" | "error";
