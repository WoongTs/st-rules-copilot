import { AppError } from "./errors";
import { decryptPat, encryptPat } from "./crypto";
import type { Env, PatRecord } from "./types";

export const PAT_TTL_SECONDS = 24 * 60 * 60;

export class TokenStore {
  constructor(private readonly env: Env) {}

  async savePat(connectionId: string, pat: string): Promise<PatRecord> {
    const record = await this.encryptRecord(connectionId, pat);
    const saved = await this.gate(connectionId).savePat(record.envelope);
    if (!saved) {
      throw inactiveConnectionError();
    }

    return { pat, expiresAt: record.expiresAt };
  }

  async consumeReconnectAndSavePat(
    connectionId: string,
    nonce: string,
    pat: string
  ): Promise<PatRecord> {
    const record = await this.encryptRecord(connectionId, pat);
    const saved = await this.gate(connectionId).consumeReconnectAndSavePat(
      nonce,
      record.envelope,
      Date.now()
    );
    if (!saved) {
      throw invalidReconnectTicketError();
    }

    return { pat, expiresAt: record.expiresAt };
  }

  async getPat(connectionId: string): Promise<PatRecord | null> {
    const envelope = await this.gate(connectionId).getPatEnvelope();
    if (!envelope) {
      return null;
    }

    const pat = await decryptPat(envelope, this.env.ST_TOKEN_ENC_KEY, connectionId);
    return { pat, expiresAt: envelope.expiresAt };
  }

  async requirePat(connectionId: string): Promise<PatRecord> {
    const record = await this.getPat(connectionId);
    if (!record) {
      throw new AppError(
        "SMARTTHINGS_PAT_EXPIRED",
        401,
        "SmartThings 연결이 만료되었습니다. 웹앱에서 PAT를 다시 연결하세요."
      );
    }
    return record;
  }

  async deletePat(connectionId: string): Promise<void> {
    await this.gate(connectionId).deletePat();
  }

  async reset(connectionId: string): Promise<void> {
    await this.gate(connectionId).reset();
  }

  private gate(connectionId: string) {
    return this.env.CONNECTION_GATE.getByName(connectionId);
  }

  private async encryptRecord(connectionId: string, pat: string) {
    const expiresAt = new Date(Date.now() + PAT_TTL_SECONDS * 1000).toISOString();
    const envelope = await encryptPat(
      pat,
      this.env.ST_TOKEN_ENC_KEY,
      connectionId,
      expiresAt
    );
    return { envelope, expiresAt };
  }
}

function inactiveConnectionError(): AppError {
  return new AppError(
    "INVALID_REQUEST",
    400,
    "이 연결 세션은 재설정되었습니다. 새로 열린 웹앱에서 다시 연결하세요."
  );
}

function invalidReconnectTicketError(): AppError {
  return new AppError(
    "INVALID_REQUEST",
    400,
    "AI 연결 복구 링크가 만료되었거나 이미 사용되었습니다. GPT/Claude 대화에서 다시 연결 링크를 받아주세요."
  );
}
