import {
  decryptReconnectTicket,
  encryptReconnectTicket,
  randomId,
  type ReconnectTicketPayload
} from "./crypto";
import { AppError } from "./errors";
import { enforceSideEffectRateLimit } from "./request-security";
import type { Env } from "./types";

export const RECONNECT_TICKET_TTL_SECONDS = 10 * 60;

export interface ReconnectTicketConnection {
  connectionId: string;
  nonce: string;
}

export async function createReconnectTicket(
  connectionId: string,
  env: Env
): Promise<string | null> {
  await enforceSideEffectRateLimit(env, connectionId);
  const now = Date.now();
  const payload: ReconnectTicketPayload = {
    connectionId,
    nonce: randomId("rnonce"),
    expiresAt: now + RECONNECT_TICKET_TTL_SECONDS * 1000,
    purpose: "pat_reconnect"
  };
  const ticket = await encryptReconnectTicket(payload, env.ST_TOKEN_ENC_KEY);
  const created = await env.CONNECTION_GATE
    .getByName(connectionId)
    .createReconnectNonce(payload.nonce, payload.expiresAt);
  return created ? ticket : null;
}

export async function readReconnectTicket(
  ticket: string,
  env: Env
): Promise<ReconnectTicketConnection> {
  const normalized = ticket.trim();
  if (!normalized || normalized.length > 4_096) {
    throw invalidReconnectTicketError();
  }

  let payload: ReconnectTicketPayload;
  try {
    payload = await decryptReconnectTicket(normalized, env.ST_TOKEN_ENC_KEY);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw invalidReconnectTicketError();
  }

  if (!validPayload(payload) || payload.expiresAt <= Date.now()) {
    throw invalidReconnectTicketError();
  }
  const exists = await env.CONNECTION_GATE
    .getByName(payload.connectionId)
    .hasReconnectNonce(payload.nonce, Date.now());
  if (!exists) {
    throw invalidReconnectTicketError();
  }
  return { connectionId: payload.connectionId, nonce: payload.nonce };
}

function validPayload(value: ReconnectTicketPayload): boolean {
  return (
    value?.purpose === "pat_reconnect" &&
    typeof value.connectionId === "string" &&
    value.connectionId.length > 0 &&
    typeof value.nonce === "string" &&
    value.nonce.length > 0 &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt)
  );
}

function invalidReconnectTicketError(): AppError {
  return new AppError(
    "INVALID_REQUEST",
    400,
    "AI 연결 복구 링크가 만료되었거나 올바르지 않습니다. GPT/Claude 대화에서 다시 연결 링크를 받아주세요."
  );
}
