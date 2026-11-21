import { AppError } from "./errors";
import type { Env } from "./types";

export const OAUTH_CONTINUATION_TTL_SECONDS = 10 * 60;

const MAX_AUTHORIZATION_QUERY_LENGTH = 8_192;
const MAX_CONTINUATION_LENGTH = 16_384;
const PURPOSE = "smartthings-rule-copilot:oauth-continuation:v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface OAuthContinuation {
  purpose: typeof PURPOSE;
  connectionId: string;
  origin: string;
  authorizationQuery: string;
  issuedAt: number;
  expiresAt: number;
}

/** Seal only an authorization request that the OAuth provider already validated. */
export async function createOAuthContinuation(
  authorizationUrl: string,
  connectionId: string,
  env: Env
): Promise<string> {
  const url = new URL(authorizationUrl);
  url.searchParams.delete("approve");
  if (url.search.length > MAX_AUTHORIZATION_QUERY_LENGTH) {
    throw invalidOAuthContinuation();
  }
  const now = Date.now();
  const payload: OAuthContinuation = {
    purpose: PURPOSE,
    connectionId,
    origin: url.origin,
    authorizationQuery: url.search,
    issuedAt: now,
    expiresAt: now + OAUTH_CONTINUATION_TTL_SECONDS * 1_000
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(PURPOSE) },
    await continuationKey(env.ST_TOKEN_ENC_KEY),
    encoder.encode(JSON.stringify(payload))
  );
  return `oc_${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

/** The returned path is fixed; the caller must revalidate the saved OAuth query. */
export async function readOAuthContinuation(
  continuation: string,
  requestUrl: string,
  connectionId: string | null,
  env: Env
): Promise<URL> {
  if (!connectionId || continuation.length > MAX_CONTINUATION_LENGTH) {
    throw invalidOAuthContinuation();
  }
  const match = /^oc_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/u.exec(continuation);
  if (!match) {
    throw invalidOAuthContinuation();
  }

  // A separate derived key prevents this token being used as a PAT or reconnect ticket.
  const key = await continuationKey(env.ST_TOKEN_ENC_KEY);
  let payload: unknown;
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64Url(match[1]),
        additionalData: encoder.encode(PURPOSE)
      },
      key,
      decodeBase64Url(match[2])
    );
    payload = JSON.parse(decoder.decode(plaintext));
  } catch {
    throw invalidOAuthContinuation();
  }

  const authorizeUrl = new URL("/oauth/authorize", requestUrl);
  if (!validContinuation(payload, connectionId, authorizeUrl.origin, Date.now())) {
    throw invalidOAuthContinuation();
  }
  authorizeUrl.search = payload.authorizationQuery;
  return authorizeUrl;
}

function validContinuation(
  value: unknown,
  connectionId: string,
  origin: string,
  now: number
): value is OAuthContinuation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<OAuthContinuation>;
  return (
    candidate.purpose === PURPOSE &&
    candidate.connectionId === connectionId &&
    candidate.origin === origin &&
    typeof candidate.authorizationQuery === "string" &&
    candidate.authorizationQuery.startsWith("?") &&
    candidate.authorizationQuery.length <= MAX_AUTHORIZATION_QUERY_LENGTH &&
    typeof candidate.issuedAt === "number" &&
    Number.isSafeInteger(candidate.issuedAt) &&
    candidate.issuedAt <= now &&
    typeof candidate.expiresAt === "number" &&
    candidate.expiresAt === candidate.issuedAt + OAUTH_CONTINUATION_TTL_SECONDS * 1_000 &&
    candidate.expiresAt > now
  );
}

async function continuationKey(secret: string | undefined): Promise<CryptoKey> {
  const normalized = secret?.trim();
  if (!normalized) {
    throw new AppError("CONFIGURATION_ERROR", 500, "서버 암호화 키가 설정되지 않았습니다.");
  }
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalized),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("smartthings-rule-copilot:v1"),
      info: encoder.encode(PURPOSE)
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (base64Url(bytes) !== value) {
    throw invalidOAuthContinuation();
  }
  return bytes;
}

function invalidOAuthContinuation(): AppError {
  return new AppError(
    "INVALID_REQUEST",
    400,
    "AI 연결 요청이 만료되었거나 현재 브라우저와 일치하지 않습니다. ChatGPT 또는 Claude에서 연결을 다시 시작해 주세요."
  );
}
