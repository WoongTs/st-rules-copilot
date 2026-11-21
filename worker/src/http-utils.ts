import { readConnectionId } from "./cookies";
import { AppError, isPatRecoveryError, toErrorBody, type AppErrorBody } from "./errors";
import { createReconnectTicket } from "./reconnect-ticket-store";
import type { RuleWriteResult } from "./service";
import type { Env } from "./types";

export async function requireExistingConnection(
  request: Request,
  env: Env
): Promise<string> {
  const connectionId = await maybeConnection(request, env);
  if (!connectionId) {
    throw new AppError(
      "SMARTTHINGS_PAT_EXPIRED",
      401,
      "SmartThings 연결이 만료되었습니다. 웹앱에서 PAT를 다시 연결하세요."
    );
  }

  return connectionId;
}

export async function maybeConnection(request: Request, env: Env): Promise<string | null> {
  if (env.AUTHENTICATED_CONNECTION_ID) {
    return env.AUTHENTICATED_CONNECTION_ID;
  }

  const cookieConnectionId = readConnectionId(request.headers.get("Cookie") ?? undefined);
  return cookieConnectionId || null;
}

export function publicBaseUrl(request: Request, env: Env): string {
  return env.APP_BASE_URL || new URL(request.url).origin;
}

export function reconnectUrl(
  request: Request,
  env: Env,
  reconnectTicket?: string | null
): string {
  const url = new URL(`${publicBaseUrl(request, env)}/connect`);
  if (reconnectTicket) {
    url.hash = new URLSearchParams({ reconnect: reconnectTicket }).toString();
  }
  return url.toString();
}

export async function reconnectUrlForConnection(
  request: Request,
  env: Env,
  connectionId: string | null
): Promise<string> {
  if (!connectionId) {
    throw reconnectUnavailableError();
  }

  const ticket = await createReconnectTicket(connectionId, env);
  if (!ticket) {
    throw reconnectUnavailableError();
  }
  return reconnectUrl(request, env, ticket);
}

function reconnectUnavailableError(): AppError {
  return new AppError(
    "RECONNECT_UNAVAILABLE",
    401,
    "기존 AI 연결을 복구할 수 없습니다. ChatGPT 또는 Claude의 연결 메뉴에서 다시 연결하세요."
  );
}

// Call only for failures while using the stored PAT. A newly submitted PAT is
// validated in its existing form; its failure must not mint a link for a cookie
// that may identify a different connection from the submitted reconnect ticket.
export async function patRecoveryErrorBody(
  error: unknown,
  request: Request,
  env: Env,
  connectionId: string | null
): Promise<AppErrorBody> {
  const body = toErrorBody(error);
  if (!isPatRecoveryError(error)) return body;

  try {
    return toErrorBody(error, await reconnectUrlForConnection(request, env, connectionId));
  } catch (recoveryError) {
    // Keep the cause of the failed operation even if issuing its recovery link
    // fails. In particular, do not disguise a reset connection as plain /connect.
    return {
      ...body,
      messageForUser: `${body.messageForUser} ${toErrorBody(recoveryError).messageForUser}`
    };
  }
}

export async function withRuleWriteRecovery<T extends RuleWriteResult>(
  result: T,
  request: Request,
  env: Env,
  connectionId: string | null
): Promise<T & { reconnectUrl?: string; messageForUser?: string }> {
  const fallbackCode = result.readback?.error?.code;
  const authenticationFailed = result.response?.status === 401 ||
    result.readback?.status === 401 ||
    fallbackCode === "SMARTTHINGS_AUTH_FAILED" ||
    fallbackCode === "SMARTTHINGS_PAT_EXPIRED";
  if (!authenticationFailed) return result;

  const writeAccepted = result.response !== null &&
    result.response.status >= 200 && result.response.status < 300;
  const message = writeAccepted
    ? "변경 요청은 성공 응답을 받았지만 인증 오류로 결과를 확인하지 못했습니다. 다시 연결한 뒤 현재 규칙부터 조회하세요. 변경 요청을 자동으로 반복하지 마세요."
    : "SmartThings 인증 오류로 변경 요청을 완료하지 못했습니다. 다시 연결한 뒤 현재 규칙을 조회하고 필요한 변경을 확인하세요. 변경 요청을 자동으로 반복하지 마세요.";
  const recovery = await patRecoveryErrorBody(
    new AppError("SMARTTHINGS_AUTH_FAILED", 401, message),
    request,
    env,
    connectionId
  );

  return {
    ...result,
    messageForUser: recovery.messageForUser,
    ...(recovery.reconnectUrl ? { reconnectUrl: recovery.reconnectUrl } : {}),
    guidance: {
      ...result.guidance,
      instructions: [
        ...(result.guidance?.instructions ?? []),
        "Authentication failed during the write or its readback. Preserve and report the complete execution evidence.",
        "Use the provided reconnect URL if available. After recovery, read the current Rule before deciding any further change. Never automatically replay the write."
      ]
    }
  };
}

export async function reconnectUrlForRequest(
  request: Request,
  env: Env
): Promise<string> {
  return reconnectUrlForConnection(request, env, await maybeConnection(request, env));
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
