import { DurableObject } from "cloudflare:workers";
import type { Env, StoredPatEnvelope } from "./types";

interface ConnectionStateRow extends Record<string, SqlStorageValue> {
  active: number;
  pat_envelope: string | null;
  pat_expires_at: number | null;
}

interface ReconnectNonceRow extends Record<string, SqlStorageValue> {
  expires_at: number;
}

interface OAuthConsentNonceRow extends Record<string, SqlStorageValue> {
  expires_at: number;
  request_hash: string;
}

interface NextExpiryRow extends Record<string, SqlStorageValue> {
  next_expiry: number | null;
}

export class ConnectionGate extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS connection_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        pat_envelope TEXT,
        pat_expires_at INTEGER,
        updated_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS reconnect_nonces (
        nonce TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS reconnect_nonces_expires_at ON reconnect_nonces(expires_at)"
    );
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS oauth_consent_nonces (
        nonce TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  async savePat(envelope: StoredPatEnvelope): Promise<boolean> {
    const saved = this.ctx.storage.transactionSync(() => {
      const current = this.readState();
      if (current && current.active !== 1) {
        return false;
      }

      this.ctx.storage.sql.exec(
        `INSERT INTO connection_state
         (singleton, active, pat_envelope, pat_expires_at, updated_at)
         VALUES (1, 1, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           pat_envelope = excluded.pat_envelope,
           pat_expires_at = excluded.pat_expires_at,
           updated_at = excluded.updated_at`,
        JSON.stringify(envelope),
        Date.parse(envelope.expiresAt),
        Date.now()
      );
      this.ctx.storage.sql.exec("DELETE FROM reconnect_nonces");
      this.ctx.storage.sql.exec("DELETE FROM oauth_consent_nonces");
      return true;
    });
    if (saved) {
      await this.scheduleNextAlarm();
    }
    return saved;
  }

  async getPatEnvelope(): Promise<StoredPatEnvelope | null> {
    const current = this.readState();
    if (
      !current ||
      current.active !== 1 ||
      !current.pat_envelope ||
      !current.pat_expires_at
    ) {
      return null;
    }

    const envelope = parsePatEnvelope(current.pat_envelope);
    if (!envelope || current.pat_expires_at <= Date.now()) {
      this.clearPat();
      await this.scheduleNextAlarm();
      return null;
    }
    return envelope;
  }

  async deletePat(): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.ensureActiveState();
      this.clearPat();
      this.ctx.storage.sql.exec("DELETE FROM oauth_consent_nonces");
    });
    await this.scheduleNextAlarm();
  }

  async reset(): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO connection_state
         (singleton, active, pat_envelope, pat_expires_at, updated_at)
         VALUES (1, 0, NULL, NULL, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           active = 0,
           pat_envelope = NULL,
           pat_expires_at = NULL,
           updated_at = excluded.updated_at`,
        Date.now()
      );
      this.ctx.storage.sql.exec("DELETE FROM reconnect_nonces");
      this.ctx.storage.sql.exec("DELETE FROM oauth_consent_nonces");
    });
    await this.ctx.storage.deleteAlarm();
  }

  async createReconnectNonce(nonce: string, expiresAt: number): Promise<boolean> {
    const created = this.ctx.storage.transactionSync(() => {
      const current = this.readState();
      if (current && current.active !== 1) {
        return false;
      }
      this.ensureActiveState();
      this.ctx.storage.sql.exec(
        "DELETE FROM reconnect_nonces WHERE expires_at <= ?",
        Date.now()
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO reconnect_nonces (nonce, expires_at)
         VALUES (?, ?)
         ON CONFLICT(nonce) DO UPDATE SET expires_at = excluded.expires_at`,
        nonce,
        expiresAt
      );
      return true;
    });
    if (created) {
      await this.scheduleNextAlarm();
    }
    return created;
  }

  async hasReconnectNonce(nonce: string, now: number): Promise<boolean> {
    const current = this.readState();
    if (!current || current.active !== 1) {
      return false;
    }
    const ticket = this.ctx.storage.sql.exec<ReconnectNonceRow>(
      "SELECT expires_at FROM reconnect_nonces WHERE nonce = ?",
      nonce
    ).toArray()[0];
    if (!ticket || ticket.expires_at <= now) {
      if (ticket) {
        this.ctx.storage.sql.exec("DELETE FROM reconnect_nonces WHERE nonce = ?", nonce);
        await this.scheduleNextAlarm();
      }
      return false;
    }
    return true;
  }

  async createOAuthConsentNonce(
    nonce: string,
    requestHash: string,
    expiresAt: number,
    now: number
  ): Promise<boolean> {
    if (!nonce || !requestHash || expiresAt <= now) {
      return false;
    }
    const created = this.ctx.storage.transactionSync(() => {
      const current = this.readState();
      if (
        !current ||
        current.active !== 1 ||
        !current.pat_envelope ||
        !current.pat_expires_at ||
        current.pat_expires_at <= now
      ) {
        return false;
      }
      this.ctx.storage.sql.exec("DELETE FROM oauth_consent_nonces");
      this.ctx.storage.sql.exec(
        `INSERT INTO oauth_consent_nonces (nonce, request_hash, expires_at)
         VALUES (?, ?, ?)`,
        nonce,
        requestHash,
        expiresAt
      );
      return true;
    });
    if (created) {
      await this.scheduleNextAlarm();
    }
    return created;
  }

  async consumeOAuthConsentNonce(
    nonce: string,
    requestHash: string,
    now: number
  ): Promise<boolean> {
    const consumed = this.ctx.storage.transactionSync(() => {
      const current = this.readState();
      if (
        !current ||
        current.active !== 1 ||
        !current.pat_envelope ||
        !current.pat_expires_at ||
        current.pat_expires_at <= now
      ) {
        return false;
      }
      const stored = this.ctx.storage.sql.exec<OAuthConsentNonceRow>(
        `SELECT request_hash, expires_at
         FROM oauth_consent_nonces WHERE nonce = ?`,
        nonce
      ).toArray()[0];
      if (
        !stored ||
        stored.expires_at <= now ||
        stored.request_hash !== requestHash
      ) {
        if (stored) {
          this.ctx.storage.sql.exec(
            "DELETE FROM oauth_consent_nonces WHERE nonce = ?",
            nonce
          );
        }
        return false;
      }
      this.ctx.storage.sql.exec("DELETE FROM oauth_consent_nonces");
      return true;
    });
    await this.scheduleNextAlarm();
    return consumed;
  }

  async consumeReconnectAndSavePat(
    nonce: string,
    envelope: StoredPatEnvelope,
    now: number
  ): Promise<boolean> {
    const saved = this.ctx.storage.transactionSync(() => {
      const current = this.readState();
      if (!current || current.active !== 1) {
        return false;
      }
      const ticket = this.ctx.storage.sql.exec<ReconnectNonceRow>(
        "SELECT expires_at FROM reconnect_nonces WHERE nonce = ?",
        nonce
      ).toArray()[0];
      if (!ticket || ticket.expires_at <= now) {
        if (ticket) {
          this.ctx.storage.sql.exec("DELETE FROM reconnect_nonces WHERE nonce = ?", nonce);
        }
        return false;
      }

      this.ctx.storage.sql.exec("DELETE FROM reconnect_nonces");
      this.ctx.storage.sql.exec("DELETE FROM oauth_consent_nonces");
      this.ctx.storage.sql.exec(
        `UPDATE connection_state
         SET pat_envelope = ?, pat_expires_at = ?, updated_at = ?
         WHERE singleton = 1 AND active = 1`,
        JSON.stringify(envelope),
        Date.parse(envelope.expiresAt),
        now
      );
      return true;
    });
    await this.scheduleNextAlarm();
    return saved;
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      const current = this.readState();
      if (current?.pat_expires_at && current.pat_expires_at <= now) {
        this.clearPat();
      }
      this.ctx.storage.sql.exec(
        "DELETE FROM reconnect_nonces WHERE expires_at <= ?",
        now
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM oauth_consent_nonces WHERE expires_at <= ?",
        now
      );
    });
    await this.scheduleNextAlarm();
  }

  private readState(): ConnectionStateRow | undefined {
    return this.ctx.storage.sql.exec<ConnectionStateRow>(
      `SELECT active, pat_envelope, pat_expires_at
       FROM connection_state WHERE singleton = 1`
    ).toArray()[0];
  }

  private ensureActiveState(): void {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO connection_state
       (singleton, active, pat_envelope, pat_expires_at, updated_at)
       VALUES (1, 1, NULL, NULL, ?)`,
      Date.now()
    );
  }

  private clearPat(): void {
    this.ctx.storage.sql.exec(
      `UPDATE connection_state
       SET pat_envelope = NULL, pat_expires_at = NULL, updated_at = ?
       WHERE singleton = 1`,
      Date.now()
    );
  }

  private async scheduleNextAlarm(): Promise<void> {
    const current = this.readState();
    const nonceExpiry = this.ctx.storage.sql.exec<NextExpiryRow>(
      "SELECT MIN(expires_at) AS next_expiry FROM reconnect_nonces"
    ).one().next_expiry;
    const consentExpiry = this.ctx.storage.sql.exec<NextExpiryRow>(
      "SELECT MIN(expires_at) AS next_expiry FROM oauth_consent_nonces"
    ).one().next_expiry;
    const candidates = [
      current?.active === 1 ? current.pat_expires_at : null,
      nonceExpiry,
      consentExpiry
    ].filter((value): value is number => typeof value === "number" && value > 0);

    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(Math.min(...candidates), Date.now() + 1_000));
  }
}

function parsePatEnvelope(value: string): StoredPatEnvelope | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredPatEnvelope>;
    if (
      parsed.v !== 1 ||
      typeof parsed.kid !== "string" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.ciphertext !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }
    return parsed as StoredPatEnvelope;
  } catch {
    return null;
  }
}
