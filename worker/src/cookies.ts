const COOKIE_NAME = "st_rule_copilot";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const CONNECTION_ID_PATTERN = /^conn_[A-Za-z0-9_-]{22}$/u;
const MAX_ENCODED_CONNECTION_ID_LENGTH = 128;

export function readConnectionId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const chunk of cookieHeader.split(";")) {
    const [rawName, ...valueParts] = chunk.trim().split("=");
    if (rawName === COOKIE_NAME) {
      const value = valueParts.join("=");
      if (!value || value.length > MAX_ENCODED_CONNECTION_ID_LENGTH) {
        return null;
      }

      try {
        const connectionId = decodeURIComponent(value);
        return CONNECTION_ID_PATTERN.test(connectionId) ? connectionId : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function buildSessionCookie(connectionId: string, requestUrl: string): string {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(connectionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];
  if (new URL(requestUrl).protocol === "https:") {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function buildExpiredSessionCookie(requestUrl: string): string {
  const attributes = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (new URL(requestUrl).protocol === "https:") {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}
