import { readConnectionId } from "./cookies";
import { AppError } from "./errors";
import { createReconnectTicket } from "./reconnect-ticket-store";
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
    return reconnectUrl(request, env);
  }

  const ticket = await createReconnectTicket(connectionId, env);
  return reconnectUrl(request, env, ticket);
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
