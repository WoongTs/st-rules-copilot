import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, connectSession, getSessionStatus } from "../src/api/client.ts";

test("API errors preserve status, code, message and reconnectUrl", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    code: "SMARTTHINGS_AUTH_FAILED",
    messageForUser: "새 PAT를 확인해 주세요.",
    reconnectUrl: "/connect#reconnect=other-browser-ticket"
  }), { status: 401 });
  try {
    await assert.rejects(connectSession("new-pat", "original-ticket"), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "SMARTTHINGS_AUTH_FAILED");
      assert.equal(error.message, "새 PAT를 확인해 주세요.");
      assert.equal(error.reconnectUrl, "/connect#reconnect=other-browser-ticket");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-JSON HTTP failure still produces a typed error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("upstream unavailable", { status: 503 });
  try {
    await assert.rejects(getSessionStatus(), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.code, "REQUEST_FAILED");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
