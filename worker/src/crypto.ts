import { AppError } from "./errors";
import type { StoredPatEnvelope } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const RECONNECT_TICKET_AAD = "smartthings-rule-copilot:pat-reconnect:v1";

export interface ReconnectTicketPayload {
  connectionId: string;
  nonce: string;
  expiresAt: number;
  purpose: "pat_reconnect";
}

export function randomId(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${prefix}_${bytesToBase64Url(bytes)}`;
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function encryptPat(
  pat: string,
  secret: string | undefined,
  connectionId: string,
  expiresAt: string
): Promise<StoredPatEnvelope> {
  try {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    const key = await importAesKey(secret);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(encoder.encode(patAad(connectionId, expiresAt)))
      },
      key,
      toArrayBuffer(encoder.encode(pat))
    );

    return {
      v: 1,
      kid: "local-v1",
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
      createdAt: new Date().toISOString(),
      expiresAt
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("TOKEN_CRYPTO_ERROR", 500, "PAT 암호화에 실패했습니다.");
  }
}

export async function decryptPat(
  envelope: StoredPatEnvelope,
  secret: string | undefined,
  connectionId: string
): Promise<string> {
  try {
    const key = await importAesKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(base64ToBytes(envelope.iv)),
        additionalData: toArrayBuffer(
          encoder.encode(patAad(connectionId, envelope.expiresAt))
        )
      },
      key,
      toArrayBuffer(base64ToBytes(envelope.ciphertext))
    );

    return decoder.decode(plaintext);
  } catch {
    throw new AppError("TOKEN_CRYPTO_ERROR", 500, "저장된 PAT를 읽지 못했습니다.");
  }
}

export async function encryptReconnectTicket(
  payload: ReconnectTicketPayload,
  secret: string | undefined
): Promise<string> {
  try {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const key = await importReconnectTicketKey(secret);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(encoder.encode(RECONNECT_TICKET_AAD))
      },
      key,
      toArrayBuffer(encoder.encode(JSON.stringify(payload)))
    );
    return `rt_${bytesToBase64Url(iv)}.${bytesToBase64Url(
      new Uint8Array(ciphertext)
    )}`;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      "TOKEN_CRYPTO_ERROR",
      500,
      "PAT 재연결 링크를 만들지 못했습니다."
    );
  }
}

export async function decryptReconnectTicket(
  ticket: string,
  secret: string | undefined
): Promise<ReconnectTicketPayload> {
  const match = /^rt_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(ticket);
  if (!match) {
    throw new Error("invalid reconnect ticket format");
  }

  try {
    const key = await importReconnectTicketKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(base64UrlToBytes(match[1])),
        additionalData: toArrayBuffer(encoder.encode(RECONNECT_TICKET_AAD))
      },
      key,
      toArrayBuffer(base64UrlToBytes(match[2]))
    );
    return JSON.parse(decoder.decode(plaintext)) as ReconnectTicketPayload;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new Error("invalid reconnect ticket");
  }
}

async function importAesKey(secret: string | undefined): Promise<CryptoKey> {
  const keyBytes = await secretKeyBytes(secret);
  return crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, [
    "encrypt",
    "decrypt"
  ]);
}

async function importReconnectTicketKey(
  secret: string | undefined
): Promise<CryptoKey> {
  const keyBytes = await secretKeyBytes(secret);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(encoder.encode("smartthings-rule-copilot:v1")),
      info: toArrayBuffer(encoder.encode("pat-reconnect-ticket"))
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function secretKeyBytes(secret: string | undefined): Promise<Uint8Array> {
  const trimmed = secret?.trim() ?? "";
  if (!trimmed) {
    throw new AppError(
      "CONFIGURATION_ERROR",
      500,
      "서버 암호화 키가 설정되지 않았습니다."
    );
  }

  const decoded = tryDecodeBase64Key(trimmed);
  const keyBytes =
    decoded && decoded.byteLength === 32
      ? decoded
      : new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(trimmed)));
  return keyBytes;
}

function tryDecodeBase64Key(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return base64ToBytes(padded);
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}

function patAad(connectionId: string, expiresAt: string): string {
  return `smartthings-rule-copilot:pat:v1\0${connectionId}\0${expiresAt}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}
