import type {
  ApiErrorBody,
  ConnectionBootstrapBody,
  DevicesBody,
  LocationsBody,
  RulesBody,
  StatusBody
} from "../types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reconnectUrl?: string;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.messageForUser || "요청이 실패했습니다.");
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code || "REQUEST_FAILED";
    this.reconnectUrl = body?.reconnectUrl;
  }
}

export async function createSession(): Promise<{ ok: true }> {
  return request("/api/session", { method: "POST" });
}

export async function resetSession(): Promise<{ ok: true; connected: false }> {
  return request("/api/session/reset", { method: "POST" });
}

export async function getSessionStatus(): Promise<StatusBody> {
  return request("/api/smartthings/status");
}

export async function connectSession(
  pat: string,
  reconnectTicket?: string
): Promise<ConnectionBootstrapBody> {
  return request("/api/smartthings/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pat,
      ...(reconnectTicket ? { reconnectTicket } : {})
    })
  });
}

export async function disconnectSession(): Promise<{ ok: true }> {
  return request("/api/smartthings/token", { method: "DELETE" });
}

export async function listLocations(): Promise<LocationsBody> {
  return request("/api/smartthings/locations");
}

export async function listDevices(locationId?: string): Promise<DevicesBody> {
  const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
  return request(`/api/smartthings/devices${query}`);
}

export async function listRules(locationId: string): Promise<RulesBody> {
  return request(`/api/smartthings/rules?locationId=${encodeURIComponent(locationId)}`);
}

export function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "요청이 실패했습니다.";
}

async function request<T = { ok: true }>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...init.headers
    }
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || isApiErrorBody(body)) {
    const errorBody = isApiErrorBody(body) ? body : null;
    throw new ApiError(response.status, errorBody);
  }
  if (body === null) {
    throw new ApiError(response.status, null);
  }

  return body as T;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === false &&
    "code" in value &&
    typeof value.code === "string" &&
    "messageForUser" in value &&
    typeof value.messageForUser === "string" &&
    (!("reconnectUrl" in value) || typeof value.reconnectUrl === "string")
  );
}
