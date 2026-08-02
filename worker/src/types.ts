import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export type Env = Omit<
  Cloudflare.Env,
  | "SMARTTHINGS_API_BASE"
  | "ST_TOKEN_ENC_KEY"
  | "GPT_ACTIONS_CLIENT_ID"
  | "GPT_ACTIONS_REDIRECT_URIS"
> & {
  SMARTTHINGS_API_BASE: string;
  ST_TOKEN_ENC_KEY?: string;
  OAUTH_PROVIDER?: OAuthHelpers;
  APP_BASE_URL?: string;
  GPT_ACTIONS_CLIENT_ID?: string;
  GPT_ACTIONS_REDIRECT_URIS?: string;
  AUTHENTICATED_CONNECTION_ID?: string;
  AUTHENTICATED_SCOPES?: string[];
};

export interface OAuthAccessProps {
  connectionId: string;
  scopes: string[];
}

export interface StoredPatEnvelope {
  v: 1;
  kid: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
  expiresAt: string;
}

export interface PatRecord {
  pat: string;
  expiresAt: string;
}

export interface LocationSummary {
  locationId: string;
  name: string;
}

export interface DeviceSummary {
  deviceId: string;
  label: string;
  name?: string;
  locationId?: string;
  roomId?: string;
  roomName?: string;
  capabilities: string[];
  components?: DeviceComponentSummary[];
}

export interface DeviceComponentSummary {
  componentId: string;
  capabilities: string[];
  capabilityVersions?: Record<string, number>;
}

export interface RuleSummary {
  id: string;
  name: string;
  locationId: string;
  status?: string;
  ownerType?: string;
  ownerId?: string;
}

export type RuleDetail = RuleSummary & Record<string, unknown>;

export type RuleTargetStatus = "Enabled" | "Disabled";

export interface SmartThingsRuleJson extends Record<string, unknown> {
  name: string;
  actions: Record<string, unknown>[];
}

export interface SmartThingsRawResponse {
  status: number;
  body: unknown;
}

export type FlowStep =
  | "reconnect"
  | "list_locations"
  | "choose_location"
  | "list_devices"
  | "confirm_rule_targets"
  | "inspect_capability_context"
  | "search_rule_references"
  | "get_rule_reference"
  | "draft_rule_json"
  | "check_rule_json_references"
  | "show_checked_draft";

export interface ToolNext {
  step: FlowStep;
  tool?: string;
  arguments?: Record<string, unknown>;
  reason: string;
}

export interface ElicitationHint {
  message: string;
  requestedSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolGuidance {
  instructions?: string[];
  next?: ToolNext;
  elicitation?: ElicitationHint;
}

export interface ToolTextContent {
  type: "text";
  text: string;
}

export interface ToolResultEnvelope<TStructured extends Record<string, unknown>>
  extends Record<string, unknown> {
  content: ToolTextContent[];
  structuredContent: TStructured;
  isError?: boolean;
}

export type ConnectionStatusSummary =
  | {
      connected: true;
      expiresAt: string;
      locationsCount: number;
    }
  | {
      connected: false;
    };

export interface ConnectionReadSummary {
  connected: true;
  expiresAt: string;
  locationsCount: number;
  devicesCount: number;
  rulesCount: number;
  locations: LocationSummary[];
  devices: DeviceSummary[];
  rules: RuleSummary[];
}
