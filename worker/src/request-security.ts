import { readConnectionId } from "./cookies";
import { sha256Base64Url } from "./crypto";
import { AppError } from "./errors";
import type { Env } from "./types";

const KIB = 1024;

export const REQUEST_BODY_LIMITS = {
  smartThingsConnect: 16 * KIB,
  oauth: 64 * KIB,
  action: 512 * KIB,
  mcp: 1024 * KIB,
  fallback: 64 * KIB
} as const;

const PUBLIC_RESOURCE_PATHS = new Set([
  "/api/session",
  "/api/session/reset",
  "/api/smartthings/connect",
  "/oauth/register",
  "/oauth/token",
  "/oauth/authorize/approve"
]);

const IP_FALLBACK_LIMIT_PATHS = new Set([
  "/api/session/reset",
  "/api/smartthings/connect",
  "/oauth/token",
  "/oauth/authorize/approve"
]);

export type RequestGuardResult =
  | { request: Request; response?: never }
  | { request?: never; response: Response };

export async function applyRequestGuards(
  request: Request,
  env: Env
): Promise<RequestGuardResult> {
  let boundedRequest: Request;
  try {
    boundedRequest = await boundedRequestBody(request);
  } catch (error) {
    if (error instanceof AppError && error.code === "PAYLOAD_TOO_LARGE") {
      return { response: transportErrorResponse(request, error) };
    }
    throw error;
  }

  if (isPublicResourceRequest(boundedRequest)) {
    const keys = [await publicResourceRateKey(boundedRequest)];
    const pathname = new URL(boundedRequest.url).pathname;
    if (IP_FALLBACK_LIMIT_PATHS.has(pathname)) {
      keys.push(await publicResourceIpRouteRateKey(boundedRequest));
    }

    for (const key of keys) {
      const outcome = await env.PUBLIC_RESOURCE_RATE_LIMITER.limit({ key });
      if (!outcome.success) {
        return {
          response: transportErrorResponse(boundedRequest, rateLimitedError())
        };
      }
    }
  }

  return { request: boundedRequest };
}

export async function enforceSideEffectRateLimit(
  env: Env,
  connectionId: string
): Promise<void> {
  const key = `side-effect:${await sha256Base64Url(connectionId)}`;
  const outcome = await env.SIDE_EFFECT_RATE_LIMITER.limit({ key });
  if (!outcome.success) {
    throw rateLimitedError();
  }
}

export function requestBodyLimit(request: Request): number {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/smartthings/connect") {
    return REQUEST_BODY_LIMITS.smartThingsConnect;
  }
  if (pathname.startsWith("/oauth/")) {
    return REQUEST_BODY_LIMITS.oauth;
  }
  if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
    return REQUEST_BODY_LIMITS.mcp;
  }
  if (pathname.startsWith("/action/")) {
    return REQUEST_BODY_LIMITS.action;
  }
  return REQUEST_BODY_LIMITS.fallback;
}

function isPublicResourceRequest(request: Request): boolean {
  return (
    request.method === "POST" &&
    PUBLIC_RESOURCE_PATHS.has(new URL(request.url).pathname)
  );
}

async function boundedRequestBody(request: Request): Promise<Request> {
  if (!request.body || request.method === "GET" || request.method === "HEAD") {
    return request;
  }

  const limit = requestBodyLimit(request);
  const declaredLength = contentLength(request.headers.get("Content-Length"));
  if (declaredLength !== null && declaredLength > limit) {
    throw payloadTooLargeError();
  }

  const reader = request.body.getReader();
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
          // The request is rejected regardless of stream cancellation errors.
        }
        throw payloadTooLargeError();
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

  const headers = new Headers(request.headers);
  headers.delete("Transfer-Encoding");
  headers.set("Content-Length", String(total));
  return new Request(request, { body, headers });
}

function contentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function publicResourceRateKey(request: Request): Promise<string> {
  const pathname = new URL(request.url).pathname;
  const connectionId = readConnectionId(
    request.headers.get("Cookie") ?? undefined
  );
  let actor: string;

  if (pathname === "/oauth/token") {
    const clientId = await oauthClientId(request);
    actor = clientId ? `oauth-client:${clientId}` : anonymousActor(request);
  } else if (
    connectionId &&
    pathname !== "/api/session" &&
    pathname !== "/oauth/register"
  ) {
    actor = `connection:${connectionId}`;
  } else {
    actor = anonymousActor(request);
  }

  return `public-resource:${await sha256Base64Url(actor)}`;
}

async function publicResourceIpRouteRateKey(request: Request): Promise<string> {
  const pathname = new URL(request.url).pathname;
  const actor = `${anonymousActor(request)}:route:${pathname}`;
  return `public-resource-ip-route:${await sha256Base64Url(actor)}`;
}

async function oauthClientId(request: Request): Promise<string> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (authorization.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice("Basic ".length));
      const separator = decoded.indexOf(":");
      if (separator > 0) {
        return decoded.slice(0, separator);
      }
    } catch {
      // Fall through to the bounded form body.
    }
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.clone().formData();
    const clientId = form.get("client_id");
    return typeof clientId === "string" ? clientId.trim() : "";
  }
  if (contentType.includes("application/json")) {
    try {
      const body = await request.clone().json<unknown>();
      if (typeof body === "object" && body !== null) {
        const clientId = (body as { client_id?: unknown }).client_id;
        return typeof clientId === "string" ? clientId.trim() : "";
      }
    } catch {
      return "";
    }
  }
  return "";
}

function anonymousActor(request: Request): string {
  return `ip:${request.headers.get("CF-Connecting-IP") || "unknown"}`;
}

function payloadTooLargeError(): AppError {
  return new AppError(
    "PAYLOAD_TOO_LARGE",
    413,
    "요청 본문이 너무 큽니다. 내용을 줄인 뒤 다시 시도하세요."
  );
}

function rateLimitedError(): AppError {
  return new AppError(
    "RATE_LIMITED",
    429,
    "요청이 너무 많습니다. 잠시 후 다시 시도하세요."
  );
}

function transportErrorResponse(request: Request, error: AppError): Response {
  const pathname = new URL(request.url).pathname;
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json"
  });
  if (error.code === "RATE_LIMITED") {
    headers.set("Retry-After", "60");
  }

  if (pathname.startsWith("/oauth/")) {
    return new Response(
      JSON.stringify({
        error:
          error.code === "RATE_LIMITED"
            ? "temporarily_unavailable"
            : "invalid_request",
        error_description:
          error.code === "RATE_LIMITED"
            ? "Too many requests. Retry later."
            : "Request body is too large."
      }),
      { status: error.status, headers }
    );
  }

  if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message:
            error.code === "RATE_LIMITED"
              ? "Too many requests. Retry later."
              : "Request body is too large."
        }
      }),
      { status: error.status, headers }
    );
  }

  return new Response(
    JSON.stringify({
      ok: false,
      code: error.code,
      messageForUser: error.messageForUser
    }),
    { status: error.status, headers }
  );
}
