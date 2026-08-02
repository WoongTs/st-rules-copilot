import { AppError, mapSmartThingsStatus } from "./errors";
import type {
  DeviceSummary,
  Env,
  LocationSummary,
  RuleDetail,
  SmartThingsRawResponse,
  SmartThingsRuleJson,
  RuleTargetStatus,
  RuleSummary
} from "./types";

interface SmartThingsList<T> {
  items?: T[];
  locations?: T[];
  devices?: T[];
  rooms?: T[];
  rules?: T[];
  _links?: {
    next?: {
      href?: unknown;
    };
  };
}

type UnknownRecord = Record<string, unknown>;

const MAX_PAGE_COUNT = 100;
const MAX_ITEM_COUNT = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

interface RoomSummary {
  roomId: string;
  name: string;
  locationId?: string;
}

export class SmartThingsClient {
  private readonly apiBaseUrl: URL;

  constructor(
    private readonly env: Env,
    private readonly pat: string
  ) {
    this.apiBaseUrl = configuredApiBaseUrl(env.SMARTTHINGS_API_BASE);
  }

  async listLocations(): Promise<LocationSummary[]> {
    const locations = await this.requestPagedItems("/locations", "locations");
    return locations.map((location) => ({
      locationId: stringValue(location.locationId ?? location.id),
      name: stringValue(location.name ?? location.label ?? "이름 없는 위치")
    }));
  }

  async listDevices(locationId?: string): Promise<DeviceSummary[]> {
    const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
    const rawDevices = await this.requestPagedItems(`/devices${query}`, "devices");

    const devices = rawDevices.map((device) => {
      const components = extractComponents(device);
      return {
        deviceId: stringValue(device.deviceId ?? device.id),
        label: stringValue(device.label ?? device.name ?? "이름 없는 기기"),
        name: optionalString(device.name),
        locationId: optionalString(device.locationId),
        roomId: optionalString(device.roomId),
        roomName: optionalString(device.roomName),
        capabilities: uniqueSorted(components.flatMap((component) => component.capabilities)),
        components
      };
    });

    return this.withRoomNames(devices, locationId);
  }

  async listRooms(locationId: string): Promise<RoomSummary[]> {
    const rooms = await this.requestPagedItems(
      `/locations/${encodeURIComponent(locationId)}/rooms`,
      "rooms"
    );

    return rooms
      .map((room) => ({
        roomId: stringValue(room.roomId ?? room.id),
        name: stringValue(room.name ?? room.label ?? "이름 없는 방"),
        locationId: optionalString(room.locationId) ?? locationId
      }))
      .filter((room) => room.roomId);
  }

  async listRules(locationId: string): Promise<RuleSummary[]> {
    const rules = await this.requestPagedItems(
      `/rules?locationId=${encodeURIComponent(locationId)}`,
      "rules"
    );

    return rules.map((rule) => ({
      id: stringValue(rule.id ?? rule.ruleId),
      name: stringValue(rule.name ?? rule.label ?? "이름 없는 Rule"),
      locationId,
      status: optionalString(rule.status),
      ownerType: optionalString(rule.ownerType),
      ownerId: optionalString(rule.ownerId)
    }));
  }

  async getRuleDetail(locationId: string, ruleId: string): Promise<RuleDetail> {
    const response = await this.getRuleDetailRaw(locationId, ruleId);
    if (response.status < 200 || response.status >= 300) {
      throw mapSmartThingsStatus(response.status);
    }
    const body = response.body;
    const bodyRecord = isRecord(body) ? body : {};
    const rule = isRecord(bodyRecord.rule) ? bodyRecord.rule : bodyRecord;

    return {
      ...rule,
      id: stringValue(rule.id ?? rule.ruleId) || ruleId,
      name: stringValue(rule.name ?? rule.label ?? "이름 없는 Rule"),
      locationId,
      ownerType: optionalString(rule.ownerType),
      ownerId: optionalString(rule.ownerId)
    };
  }

  async createRule(
    locationId: string,
    ruleJson: SmartThingsRuleJson
  ): Promise<SmartThingsRawResponse> {
    const response = await this.requestRaw(
      `/rules?locationId=${encodeURIComponent(locationId)}`,
      {
        method: "POST",
        body: ruleJson
      }
    );

    if (response.status >= 200 && response.status < 300) {
      return response;
    }

    if (response.status === 400 || response.status === 422) {
      return response;
    }

    throw mapSmartThingsStatus(response.status);
  }

  async deleteRule(locationId: string, ruleId: string): Promise<SmartThingsRawResponse> {
    return this.requestRaw(
      `/rules/${encodeURIComponent(ruleId)}?locationId=${encodeURIComponent(locationId)}`,
      {
        method: "DELETE"
      }
    );
  }

  async setRuleStatus(
    locationId: string,
    ruleId: string,
    targetStatus: RuleTargetStatus
  ): Promise<SmartThingsRawResponse> {
    const operation = targetStatus === "Enabled" ? "enable" : "disable";
    return this.requestRaw(
      `/rules/${encodeURIComponent(ruleId)}/status/${operation}?locationId=${encodeURIComponent(locationId)}`,
      {
        method: "PUT"
      }
    );
  }

  async updateRule(
    locationId: string,
    ruleId: string,
    ruleJson: SmartThingsRuleJson
  ): Promise<SmartThingsRawResponse> {
    const response = await this.requestRaw(
      `/rules/${encodeURIComponent(ruleId)}?locationId=${encodeURIComponent(locationId)}`,
      {
        method: "PUT",
        body: ruleJson
      }
    );

    if (response.status >= 200 && response.status < 300) {
      return response;
    }

    if (response.status === 400 || response.status === 422) {
      return response;
    }

    throw mapSmartThingsStatus(response.status);
  }

  async getCapabilityDefinition(
    capabilityId: string,
    capabilityVersion: number
  ): Promise<UnknownRecord> {
    return this.request<UnknownRecord>(
      `/capabilities/${encodeURIComponent(capabilityId)}/${capabilityVersion}`
    );
  }

  async getDeviceCapabilityStatus(
    deviceId: string,
    componentId: string,
    capabilityId: string
  ): Promise<UnknownRecord> {
    return this.request<UnknownRecord>(
      `/devices/${encodeURIComponent(deviceId)}/components/${encodeURIComponent(componentId)}/capabilities/${encodeURIComponent(capabilityId)}/status`
    );
  }

  async getCapabilityPresentation(
    capabilityId: string,
    capabilityVersion: number
  ): Promise<UnknownRecord> {
    return this.request<UnknownRecord>(
      `/capabilities/${encodeURIComponent(capabilityId)}/${capabilityVersion}/presentation`
    );
  }

  private async request<T>(path: string): Promise<T> {
    const response = await this.requestRaw(path);
    if (response.status < 200 || response.status >= 300) {
      throw mapSmartThingsStatus(response.status);
    }

    return response.body as T;
  }

  private async requestRaw(
    path: string,
    init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {}
  ): Promise<SmartThingsRawResponse> {
    const url = this.resolveApiUrl(path);
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.pat}`
    };
    const hasBody = init.body !== undefined;
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url.toString(), {
      method: init.method ?? "GET",
      headers,
      ...(hasBody ? { body: JSON.stringify(init.body) } : {})
    });

    const text = await boundedResponseText(response, MAX_RESPONSE_BYTES);
    const body = text ? safeJsonParse(text) : null;

    return {
      status: response.status,
      body
    };
  }

  async getRuleDetailRaw(
    locationId: string,
    ruleId: string
  ): Promise<SmartThingsRawResponse> {
    return this.requestRaw(
      `/rules/${encodeURIComponent(ruleId)}?locationId=${encodeURIComponent(locationId)}`
    );
  }

  private async requestPagedItems(
    path: string,
    collectionKey: "locations" | "devices" | "rooms" | "rules"
  ): Promise<UnknownRecord[]> {
    const items: UnknownRecord[] = [];
    const visited = new Set<string>();
    const expectedPathname = this.resolveApiUrl(path).pathname;
    let nextPath: string | undefined = path;

    while (nextPath) {
      const nextUrl = this.resolvePageApiUrl(nextPath, expectedPathname).toString();
      if (visited.has(nextUrl)) {
        break;
      }
      if (visited.size >= MAX_PAGE_COUNT) {
        throw upstreamBoundaryError("SmartThings 페이지 수가 허용 범위를 넘었습니다.");
      }

      visited.add(nextUrl);
      const body = await this.request<SmartThingsList<UnknownRecord> | UnknownRecord[]>(
        nextUrl
      );
      const pageItems = toItems(body, collectionKey);
      if (items.length + pageItems.length > MAX_ITEM_COUNT) {
        throw upstreamBoundaryError("SmartThings 목록 크기가 허용 범위를 넘었습니다.");
      }
      items.push(...pageItems);
      nextPath = nextPageHref(body);
    }

    return items;
  }

  private resolveApiUrl(path: string): URL {
    const url = this.resolveApiOriginUrl(path);
    if (!url.pathname.startsWith(this.apiBaseUrl.pathname)) {
      throw upstreamBoundaryError("SmartThings API 범위를 벗어난 응답 링크를 거부했습니다.");
    }
    return url;
  }

  private resolvePageApiUrl(path: string, expectedPathname: string): URL {
    const url = this.resolveApiOriginUrl(path);
    const versionlessPathname = versionlessV1Pathname(expectedPathname, this.apiBaseUrl.pathname);

    if (versionlessPathname && url.pathname === versionlessPathname) {
      url.pathname = expectedPathname;
    }

    if (url.pathname !== expectedPathname) {
      throw upstreamBoundaryError("SmartThings API 범위를 벗어난 응답 링크를 거부했습니다.");
    }
    return url;
  }

  private resolveApiOriginUrl(path: string): URL {
    const url = new URL(path.replace(/^\/+/u, ""), this.apiBaseUrl);
    if (
      url.protocol !== "https:" ||
      url.origin !== this.apiBaseUrl.origin ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      throw upstreamBoundaryError("SmartThings API 범위를 벗어난 응답 링크를 거부했습니다.");
    }
    return url;
  }

  private async withRoomNames(
    devices: DeviceSummary[],
    requestedLocationId?: string
  ): Promise<DeviceSummary[]> {
    const devicesMissingRoomName = devices.filter((device) => device.roomId && !device.roomName);
    if (devicesMissingRoomName.length === 0) {
      return devices;
    }

    const roomNames = await this.roomNameMapForDevices(devicesMissingRoomName, requestedLocationId);
    if (roomNames.size === 0) {
      return devices;
    }

    return devices.map((device) => {
      if (!device.roomId || device.roomName) {
        return device;
      }

      const name =
        roomNames.get(roomMapKey(device.locationId ?? requestedLocationId, device.roomId)) ??
        roomNames.get(device.roomId);
      return name ? { ...device, roomName: name } : device;
    });
  }

  private async roomNameMapForDevices(
    devices: DeviceSummary[],
    requestedLocationId?: string
  ): Promise<Map<string, string>> {
    const locationIds = uniqueSorted(
      requestedLocationId
        ? [requestedLocationId]
        : devices.map((device) => device.locationId).filter(isString)
    );
    if (locationIds.length === 0) {
      return new Map();
    }

    const roomLists = await Promise.all(
      locationIds.map(async (locationId) => ({
        locationId,
        rooms: await this.tryListRooms(locationId)
      }))
    );
    const roomNames = new Map<string, string>();

    for (const { locationId, rooms } of roomLists) {
      for (const room of rooms) {
        roomNames.set(roomMapKey(room.locationId ?? locationId, room.roomId), room.name);
        roomNames.set(room.roomId, room.name);
      }
    }

    return roomNames;
  }

  private async tryListRooms(locationId: string): Promise<RoomSummary[]> {
    try {
      return await this.listRooms(locationId);
    } catch {
      return [];
    }
  }
}

function toItems<T extends UnknownRecord>(
  body: SmartThingsList<T> | T[],
  collectionKey: "locations" | "devices" | "rooms" | "rules"
): T[] {
  if (Array.isArray(body)) {
    return body;
  }

  if (Array.isArray(body.items)) {
    return body.items;
  }

  const collection = body[collectionKey];
  return Array.isArray(collection) ? collection : [];
}

function nextPageHref(body: SmartThingsList<UnknownRecord> | UnknownRecord[]): string | undefined {
  if (Array.isArray(body)) {
    return undefined;
  }

  const href = body._links?.next?.href;
  return typeof href === "string" && href.length > 0 ? href : undefined;
}

function versionlessV1Pathname(
  expectedPathname: string,
  configuredBasePathname: string
): string | undefined {
  if (configuredBasePathname !== "/v1/" || !expectedPathname.startsWith("/v1/")) {
    return undefined;
  }

  return expectedPathname.slice("/v1".length);
}

function configuredApiBaseUrl(value: string | undefined): URL {
  const raw = value?.trim() || "https://api.smartthings.com/v1";
  let url: URL;
  try {
    url = new URL(raw.endsWith("/") ? raw : `${raw}/`);
  } catch {
    throw new AppError(
      "CONFIGURATION_ERROR",
      500,
      "SmartThings API 설정이 올바르지 않습니다."
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new AppError(
      "CONFIGURATION_ERROR",
      500,
      "SmartThings API 설정이 올바르지 않습니다."
    );
  }
  return url;
}

async function boundedResponseText(response: Response, limit: number): Promise<string> {
  if (!response.body) {
    return "";
  }

  const declaredLength = response.headers.get("Content-Length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > limit) {
    await response.body.cancel();
    throw upstreamBoundaryError("SmartThings 응답 본문이 허용 범위를 넘었습니다.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel();
        } catch {
          // The upstream response is rejected regardless of cancellation errors.
        }
        throw upstreamBoundaryError("SmartThings 응답 본문이 허용 범위를 넘었습니다.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function upstreamBoundaryError(messageForUser: string): AppError {
  return new AppError("SMARTTHINGS_API_ERROR", 502, messageForUser);
}

function extractComponents(device: UnknownRecord): NonNullable<DeviceSummary["components"]> {
  const components = Array.isArray(device.components) ? device.components : [];
  const summaries: NonNullable<DeviceSummary["components"]> = [];

  for (const component of components) {
    if (!isRecord(component) || !Array.isArray(component.capabilities)) {
      continue;
    }

    const capabilities = new Set<string>();
    const capabilityVersions: Record<string, number> = {};
    for (const capability of component.capabilities) {
      if (!isRecord(capability)) {
        continue;
      }
      const id = optionalString(capability.id ?? capability.capabilityId);
      if (id) {
        capabilities.add(id);
        const version = numberValue(capability.version ?? capability.capabilityVersion);
        if (version) {
          capabilityVersions[id] = version;
        }
      }
    }

    if (capabilities.size > 0) {
      summaries.push({
        componentId: stringValue(component.id ?? component.componentId ?? "main") || "main",
        capabilities: [...capabilities].sort(),
        ...(Object.keys(capabilityVersions).length > 0 ? { capabilityVersions } : {})
      });
    }
  }

  return summaries;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function roomMapKey(locationId: string | undefined, roomId: string): string {
  return locationId ? `${locationId}:${roomId}` : roomId;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value ? value : "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : undefined;
  }

  return undefined;
}
