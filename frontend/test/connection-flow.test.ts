import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONNECTION_FLOW_STORAGE_KEY,
  CONNECTION_FLOW_TTL_MS,
  captureConnectionFlow,
  emptyConnectionFlow,
  expireConnectionFlow,
  isTerminalRecoveryError,
  persistConnectionFlow,
  readConnectionFlow,
  recoveryFlowFromUrl,
  serializeConnectionFlow,
  type ConnectionFlowStorage
} from "../src/connection-flow.ts";

function memoryStorage(): ConnectionFlowStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); }
  };
}

test("reload keeps the original ticket and deadline after removing its fragment", () => {
  const storage = memoryStorage();
  const first = captureConnectionFlow("#reconnect=ticket-A", storage, 1_000);
  assert.equal(first.hash, "");
  assert.deepEqual(first.flow.recovery, { phase: "active", ticket: "ticket-A", expiresAt: 1_000 + CONNECTION_FLOW_TTL_MS });

  const reloaded = captureConnectionFlow("", storage, 60_000);
  assert.deepEqual(reloaded.flow, first.flow);
  const expired = captureConnectionFlow("", storage, 1_000 + CONNECTION_FLOW_TTL_MS);
  assert.deepEqual(expired.flow.recovery, { phase: "blocked", reason: "expired" });
  assert.equal(storage.getItem(CONNECTION_FLOW_STORAGE_KEY)?.includes("ticket-A"), false);
  assert.deepEqual(captureConnectionFlow("", storage, 999_999).flow.recovery, expired.flow.recovery);
});

test("empty, duplicate and conflicting link contexts remain blocked instead of becoming generic", () => {
  for (const hash of ["#reconnect=", "#reconnect=a&reconnect=b", "#reconnect=a&oauth_continue=b"]) {
    assert.equal(readConnectionFlow(hash, null, 0).recovery.phase, "blocked");
  }
  assert.equal(readConnectionFlow("", "broken JSON", 0).recovery.phase, "blocked");
});

test("successful recovery stores a nonsecret completed marker and permits an explicit exit", () => {
  const storage = memoryStorage();
  const completed = { recovery: { phase: "completed" as const }, oauth: { phase: "none" as const } };
  assert.equal(persistConnectionFlow(completed, storage), true);
  assert.deepEqual(captureConnectionFlow("", storage, 0).flow, completed);
  assert.equal(persistConnectionFlow(emptyConnectionFlow(), storage), true);
  assert.equal(storage.getItem(CONNECTION_FLOW_STORAGE_KEY), null);
  assert.deepEqual(captureConnectionFlow("", storage, 0).flow, emptyConnectionFlow());
});

test("ticket errors terminate recovery while a rejected new PAT remains retryable", () => {
  assert.equal(isTerminalRecoveryError("RECONNECT_LINK_INVALID"), true);
  assert.equal(isTerminalRecoveryError("RECONNECT_UNAVAILABLE"), true);
  assert.equal(isTerminalRecoveryError("SMARTTHINGS_AUTH_FAILED"), false);
  assert.equal(isTerminalRecoveryError("NETWORK_ERROR"), false);
});

test("OAuth continuation survives reload and uses its independent server token size limit", () => {
  const storage = memoryStorage();
  const token = `oc_${"x".repeat(8_000)}`;
  const first = captureConnectionFlow(`#oauth_continue=${token}`, storage, 0);
  assert.equal(first.flow.oauth.phase, "active");
  assert.deepEqual(captureConnectionFlow("", storage, 5_000).flow, first.flow);
  assert.deepEqual(expireConnectionFlow(first.flow, CONNECTION_FLOW_TTL_MS).oauth, { phase: "expired" });
  assert.equal(readConnectionFlow(`#reconnect=${token}`, null, 0).recovery.phase, "blocked");
  assert.equal(readConnectionFlow(`#oauth_continue=${"x".repeat(16_385)}`, null, 0).oauth.phase, "expired");
});

test("failed session storage leaves the fragment intact so reload cannot lose recovery", () => {
  const storage: ConnectionFlowStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("storage disabled"); },
    removeItem: () => { throw new Error("storage disabled"); }
  };
  const first = captureConnectionFlow("#reconnect=ticket-A", storage, 0);
  assert.equal(first.hash, "#reconnect=ticket-A");
  assert.equal(captureConnectionFlow(first.hash, storage, 60_000).flow.recovery.phase, "active");
  assert.equal(captureConnectionFlow("#reconnect=ticket-A", null, 0).hash, "#reconnect=ticket-A");
  const unreadableStorage: ConnectionFlowStorage = { ...memoryStorage(), getItem: () => { throw new Error("cannot read"); } };
  assert.equal(captureConnectionFlow("#reconnect=ticket-A", unreadableStorage, 0).hash, "#reconnect=ticket-A");
});

test("new explicit link replaces a previous flow without copying unrelated stored fields", () => {
  const previous = JSON.stringify({ version: 1, recovery: { phase: "completed", pat: "must-not-copy" }, oauth: { phase: "none" } });
  const restored = readConnectionFlow("", previous, 0);
  assert.equal(serializeConnectionFlow(restored)?.includes("must-not-copy"), false);
  const next = readConnectionFlow("#reconnect=ticket-B", previous, 0);
  assert.deepEqual(next.recovery, { phase: "active", ticket: "ticket-B", expiresAt: CONNECTION_FLOW_TTL_MS });
});

test("read-error recovery links must contain a bound ticket on this application's origin", () => {
  const origin = "https://copilot.example";
  const flow = recoveryFlowFromUrl(`${origin}/connect#reconnect=ticket-A`, origin, 0);
  assert.deepEqual(flow?.recovery, { phase: "active", ticket: "ticket-A", expiresAt: CONNECTION_FLOW_TTL_MS });
  for (const value of ["/connect", "/connect#reconnect=", "https://other.example/connect#reconnect=ticket-A", "javascript:alert(1)"]) {
    assert.equal(recoveryFlowFromUrl(value, origin, 0), null);
  }
});

test("a recovery offered during OAuth preserves continuation without extending either deadline", () => {
  const combined = {
    recovery: { phase: "active" as const, ticket: "ticket-A", expiresAt: 300_000 },
    oauth: { phase: "active" as const, token: "oc_continuation", expiresAt: 200_000 }
  };
  assert.deepEqual(readConnectionFlow("", serializeConnectionFlow(combined), 60_000), combined);
  const expired = expireConnectionFlow(combined, 300_001);
  assert.deepEqual(expired.recovery, { phase: "blocked", reason: "expired" });
  assert.deepEqual(expired.oauth, { phase: "expired" });
  assert.equal(serializeConnectionFlow(expired)?.includes("ticket-A"), false);
  assert.equal(serializeConnectionFlow(expired)?.includes("oc_continuation"), false);
});
