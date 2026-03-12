/**
 * Tests for the 012-chat-sessions migration.
 *
 * Covers two concerns:
 *   1. Table creation — the chat_sessions table and its UNIQUE index are created correctly,
 *      enforcing the COALESCE-based uniqueness constraint.
 *   2. File migration — existing workspace-level session.json files and thread-level
 *      sessions/{threadTs}.json files are moved into DB rows and deleted from disk.
 *
 * Each test gets a fresh in-memory SQLite database (no schema pre-applied) so up() runs
 * against a blank slate. File migration tests create a temporary directory tree, set
 * DATA_DIR to point at it, and restore the env var afterwards.
 */
import SQLite from "better-sqlite3";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { up } from "./012-chat-sessions";

type ChatSessionRow = {
  id: number;
  workspace_key: string;
  thread_key: string | null;
  session_id: string;
  updated_at: string;
};

function createBlankDb(): Kysely<unknown> {
  return new Kysely<unknown>({
    dialect: new SqliteDialect({ database: new SQLite(":memory:") }),
  });
}

async function querySessions(db: Kysely<unknown>): Promise<ChatSessionRow[]> {
  return (db as Kysely<{ chat_sessions: ChatSessionRow }>)
    .selectFrom("chat_sessions")
    .selectAll()
    .execute();
}

describe("012-chat-sessions migration", () => {
  let db: Kysely<unknown>;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    db = createBlankDb();
    originalDataDir = process.env.DATA_DIR;
  });

  afterEach(async () => {
    await db.destroy();
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
  });

  describe("table creation", () => {
    it("creates the chat_sessions table and allows inserting and querying rows", async () => {
      await up(db);

      await (db as Kysely<{ chat_sessions: Omit<ChatSessionRow, "id" | "updated_at"> }>)
        .insertInto("chat_sessions")
        .values({ workspace_key: "user-U1", thread_key: null, session_id: "sess_001" })
        .execute();

      const rows = await querySessions(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].workspace_key).toBe("user-U1");
      expect(rows[0].thread_key).toBeNull();
      expect(rows[0].session_id).toBe("sess_001");
    });

    it("UNIQUE constraint prevents duplicate workspace-level entries (same workspace_key, null thread_key)", async () => {
      await up(db);

      const insert = (db as Kysely<{ chat_sessions: Omit<ChatSessionRow, "id" | "updated_at"> }>)
        .insertInto("chat_sessions")
        .values({ workspace_key: "user-U1", thread_key: null, session_id: "sess_001" });

      await insert.execute();
      await expect(insert.execute()).rejects.toThrow();
    });

    it("UNIQUE constraint prevents duplicate thread-level entries (same workspace_key and thread_key)", async () => {
      await up(db);

      const insert = (db as Kysely<{ chat_sessions: Omit<ChatSessionRow, "id" | "updated_at"> }>)
        .insertInto("chat_sessions")
        .values({ workspace_key: "channel-C1", thread_key: "1111.0000", session_id: "sess_a" });

      await insert.execute();
      await expect(insert.execute()).rejects.toThrow();
    });

    it("UNIQUE constraint allows different thread_keys for the same workspace_key", async () => {
      await up(db);

      await (db as Kysely<{ chat_sessions: Omit<ChatSessionRow, "id" | "updated_at"> }>)
        .insertInto("chat_sessions")
        .values([
          { workspace_key: "channel-C1", thread_key: "1111.0000", session_id: "sess_a" },
          { workspace_key: "channel-C1", thread_key: "2222.0000", session_id: "sess_b" },
        ])
        .execute();

      const rows = await querySessions(db);
      expect(rows).toHaveLength(2);
    });
  });

  describe("file migration", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await (async () => {
        const base = join(tmpdir(), `sketch-migration-test-${Date.now()}`);
        await mkdir(base, { recursive: true });
        return base;
      })();
      process.env.DATA_DIR = tempDir;
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("migrates workspace-level session.json to a DB row with null thread_key", async () => {
      const workspacesDir = join(tempDir, "workspaces", "user-U1");
      await mkdir(workspacesDir, { recursive: true });
      await writeFile(join(workspacesDir, "session.json"), JSON.stringify({ sessionId: "sess_ws_001" }));

      await up(db);

      const rows = await querySessions(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].workspace_key).toBe("user-U1");
      expect(rows[0].thread_key).toBeNull();
      expect(rows[0].session_id).toBe("sess_ws_001");
    });

    it("deletes workspace-level session.json after migration", async () => {
      const workspacesDir = join(tempDir, "workspaces", "user-U1");
      await mkdir(workspacesDir, { recursive: true });
      const sessionFile = join(workspacesDir, "session.json");
      await writeFile(sessionFile, JSON.stringify({ sessionId: "sess_ws_002" }));

      await up(db);

      await expect(readdir(workspacesDir)).resolves.not.toContain("session.json");
    });

    it("migrates thread-level sessions/{threadTs}.json files to DB rows with correct thread_key", async () => {
      const sessionsDir = join(tempDir, "workspaces", "channel-C1", "sessions");
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(sessionsDir, "1111.0000.json"), JSON.stringify({ sessionId: "sess_thread_001" }));
      await writeFile(join(sessionsDir, "2222.0000.json"), JSON.stringify({ sessionId: "sess_thread_002" }));

      await up(db);

      const rows = await querySessions(db);
      expect(rows).toHaveLength(2);

      const byThread = Object.fromEntries(rows.map((r) => [r.thread_key, r.session_id]));
      expect(byThread["1111.0000"]).toBe("sess_thread_001");
      expect(byThread["2222.0000"]).toBe("sess_thread_002");
    });

    it("deletes thread session files after migration", async () => {
      const sessionsDir = join(tempDir, "workspaces", "channel-C1", "sessions");
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(sessionsDir, "1111.0000.json"), JSON.stringify({ sessionId: "sess_t" }));

      await up(db);

      await expect(readdir(join(tempDir, "workspaces", "channel-C1"))).resolves.not.toContain("sessions");
    });

    it("removes empty sessions/ directory after all files are migrated", async () => {
      const sessionsDir = join(tempDir, "workspaces", "channel-C1", "sessions");
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(sessionsDir, "1111.0000.json"), JSON.stringify({ sessionId: "sess_t" }));

      await up(db);

      const workspaceContents = await readdir(join(tempDir, "workspaces", "channel-C1"));
      expect(workspaceContents).not.toContain("sessions");
    });

    it("handles a missing workspaces directory gracefully without throwing", async () => {
      await expect(up(db)).resolves.not.toThrow();
    });

    it("skips malformed session files without failing and continues migrating valid ones", async () => {
      const workspacesDir = join(tempDir, "workspaces");
      const goodWorkspace = join(workspacesDir, "user-U1");
      const badWorkspace = join(workspacesDir, "user-U2");
      await mkdir(goodWorkspace, { recursive: true });
      await mkdir(badWorkspace, { recursive: true });

      await writeFile(join(goodWorkspace, "session.json"), JSON.stringify({ sessionId: "sess_valid" }));
      await writeFile(join(badWorkspace, "session.json"), "not-valid-json{{");

      await expect(up(db)).resolves.not.toThrow();

      const rows = await querySessions(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].session_id).toBe("sess_valid");
    });

    it("skips thread files with no sessionId field without inserting a row", async () => {
      const sessionsDir = join(tempDir, "workspaces", "channel-C1", "sessions");
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(join(sessionsDir, "1111.0000.json"), JSON.stringify({ other: "data" }));

      await up(db);

      const rows = await querySessions(db);
      expect(rows).toHaveLength(0);
    });
  });
});
