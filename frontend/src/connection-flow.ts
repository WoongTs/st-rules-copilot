export const CONNECTION_FLOW_STORAGE_KEY = "st-rules-copilot:connection-flow:v1";
export const CONNECTION_FLOW_TTL_MS = 10 * 60 * 1_000;

export type RecoveryState =
  | { phase: "none" }
  | { phase: "active"; ticket: string; expiresAt: number }
  | { phase: "blocked"; reason: "expired" | "invalid" }
  | { phase: "completed" };

export type OAuthContinuationState =
  | { phase: "none" }
  | { phase: "active"; token: string; expiresAt: number }
  | { phase: "expired" };

export interface ConnectionFlow {
  recovery: RecoveryState;
  oauth: OAuthContinuationState;
}

export type ConnectionFlowStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function captureConnectionFlow(hash: string, storage: ConnectionFlowStorage | null, now = Date.now()) {
  let saved: string | null = null;
  let readable = true;
  try {
    saved = storage?.getItem(CONNECTION_FLOW_STORAGE_KEY) ?? null;
  } catch {
    // Storage may be disabled. The URL fragment remains the reload fallback.
    readable = false;
  }
  const flow = readConnectionFlow(hash, saved, now);
  const persisted = readable && persistConnectionFlow(flow, storage);
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return {
    flow,
    hash: persisted && (params.has("reconnect") || params.has("oauth_continue"))
      ? stripFlowTokensFromHash(hash)
      : hash
  };
}

export function persistConnectionFlow(flow: ConnectionFlow, storage: ConnectionFlowStorage | null): boolean {
  if (!storage) return false;
  try {
    const serialized = serializeConnectionFlow(flow);
    if (serialized === null) storage.removeItem(CONNECTION_FLOW_STORAGE_KEY);
    else storage.setItem(CONNECTION_FLOW_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function emptyConnectionFlow(): ConnectionFlow {
  return { recovery: { phase: "none" }, oauth: { phase: "none" } };
}

/** Never put the PAT in this state. Only short-lived, opaque flow tokens belong here. */
export function readConnectionFlow(
  hash: string,
  saved: string | null,
  now = Date.now()
): ConnectionFlow {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const reconnectValues = params.getAll("reconnect");
  const continuationValues = params.getAll("oauth_continue");

  if (reconnectValues.length > 0 || continuationValues.length > 0) {
    if (reconnectValues.length + continuationValues.length !== 1) {
      return invalidRecoveryFlow();
    }
    if (reconnectValues.length === 1) {
      const ticket = reconnectValues[0].trim();
      return validOpaqueToken(ticket)
        ? { recovery: { phase: "active", ticket, expiresAt: now + CONNECTION_FLOW_TTL_MS }, oauth: { phase: "none" } }
        : invalidRecoveryFlow();
    }
    const token = continuationValues[0].trim();
    return {
      recovery: { phase: "none" },
      oauth: validOpaqueToken(token, 16_384)
        ? { phase: "active", token, expiresAt: now + CONNECTION_FLOW_TTL_MS }
        : { phase: "expired" }
    };
  }

  if (saved === null) return emptyConnectionFlow();
  try {
    const parsed: unknown = JSON.parse(saved);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.recovery) || !isRecord(parsed.oauth)) {
      return invalidRecoveryFlow();
    }

    const recovery = readSavedRecovery(parsed.recovery, now);
    const oauth = readSavedOAuth(parsed.oauth, now);
    if (!recovery || !oauth) {
      return invalidRecoveryFlow();
    }
    return { recovery, oauth };
  } catch {
    // A damaged recovery marker must not turn a reload into a new generic connection.
    return invalidRecoveryFlow();
  }
}

export function expireConnectionFlow(flow: ConnectionFlow, now = Date.now()): ConnectionFlow {
  const recoveryExpired = flow.recovery.phase === "active" && flow.recovery.expiresAt <= now;
  const oauthExpired = flow.oauth.phase === "active" && flow.oauth.expiresAt <= now;
  return recoveryExpired || oauthExpired ? {
    recovery: recoveryExpired ? { phase: "blocked", reason: "expired" } : flow.recovery,
    oauth: oauthExpired ? { phase: "expired" } : flow.oauth
  } : flow;
}

export function recoveryFlowFromUrl(value: string | undefined, origin: string, now = Date.now()): ConnectionFlow | null {
  if (!value) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || (url.pathname !== "/connect" && url.pathname !== "/")) return null;
    const flow = readConnectionFlow(url.hash, null, now);
    return flow.recovery.phase === "active" && flow.oauth.phase === "none" ? flow : null;
  } catch {
    return null;
  }
}

export function serializeConnectionFlow(flow: ConnectionFlow): string | null {
  if (flow.recovery.phase === "none" && flow.oauth.phase === "none") return null;
  return JSON.stringify({ version: 1, ...flow });
}

export function stripFlowTokensFromHash(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  params.delete("reconnect");
  params.delete("oauth_continue");
  const remaining = params.toString();
  return remaining ? `#${remaining}` : "";
}

export function isTerminalRecoveryError(code: string): boolean {
  return code === "RECONNECT_LINK_INVALID" || code === "RECONNECT_UNAVAILABLE";
}

function readSavedRecovery(value: Record<string, unknown>, now: number): RecoveryState | null {
  if (value.phase === "none" || value.phase === "completed") return { phase: value.phase };
  if (value.phase === "blocked" && (value.reason === "expired" || value.reason === "invalid")) {
    return { phase: "blocked", reason: value.reason };
  }
  if (value.phase !== "active" || !validOpaqueToken(value.ticket) || !validDeadline(value.expiresAt, now)) return null;
  return value.expiresAt <= now
    ? { phase: "blocked", reason: "expired" }
    : { phase: "active", ticket: value.ticket, expiresAt: value.expiresAt };
}

function readSavedOAuth(value: Record<string, unknown>, now: number): OAuthContinuationState | null {
  if (value.phase === "none" || value.phase === "expired") return { phase: value.phase };
  if (value.phase !== "active" || !validOpaqueToken(value.token, 16_384) || !validDeadline(value.expiresAt, now)) return null;
  return value.expiresAt <= now
    ? { phase: "expired" }
    : { phase: "active", token: value.token, expiresAt: value.expiresAt };
}

function validDeadline(value: unknown, now: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value <= now + CONNECTION_FLOW_TTL_MS;
}

function validOpaqueToken(value: unknown, maxLength = 4_096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/\s/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRecoveryFlow(): ConnectionFlow {
  return { recovery: { phase: "blocked", reason: "invalid" }, oauth: { phase: "none" } };
}
