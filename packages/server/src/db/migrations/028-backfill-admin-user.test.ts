import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { up } from "./028-backfill-admin-user";

function createBlankDb(): Kysely<unknown> {
  return new Kysely<unknown>({
    dialect: new SqliteDialect({ database: new SQLite(":memory:") }),
  });
}

async function createTables(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("settings")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("admin_email", "text")
    .execute();

  await db.schema
    .createTable("users")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("email", "text", (col) => col.unique())
    .addColumn("email_verified_at", "text")
    .addColumn("type", "text", (col) => col.notNull().defaultTo("human"))
    .addColumn("created_at", "timestamp", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable("chat_sessions")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("workspace_key", "text", (col) => col.notNull())
    .addColumn("thread_key", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("session_id", "text", (col) => col.notNull())
    .addColumn("updated_at", "timestamp", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();
}

let db: Kysely<unknown>;

beforeEach(async () => {
  db = createBlankDb();
  await createTables(db);
});

afterEach(async () => {
  await db.destroy();
});

describe("028-backfill-admin-user", () => {
  it("creates admin user row and rekeys chat_sessions when no user exists", async () => {
    await sql`INSERT INTO settings (id, admin_email) VALUES ('default', 'admin@test.com')`.execute(db);
    await sql`INSERT INTO chat_sessions (workspace_key, thread_key, session_id) VALUES ('admin@test.com', '', 'sess-1')`.execute(
      db,
    );

    await up(db);

    const users = await sql<{ id: string; name: string; email: string; email_verified_at: string; type: string }>`
      SELECT id, name, email, email_verified_at, type FROM users
    `.execute(db);
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0].email).toBe("admin@test.com");
    expect(users.rows[0].name).toBe("admin");
    expect(users.rows[0].email_verified_at).toBeTruthy();
    expect(users.rows[0].type).toBe("human");

    const sessions = await sql<{ workspace_key: string }>`
      SELECT workspace_key FROM chat_sessions
    `.execute(db);
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0].workspace_key).toBe(users.rows[0].id);
  });

  it("reuses existing user row when admin email already has a user", async () => {
    await sql`INSERT INTO settings (id, admin_email) VALUES ('default', 'admin@test.com')`.execute(db);
    await sql`INSERT INTO users (id, name, email) VALUES ('existing-uuid', 'Existing Admin', 'admin@test.com')`.execute(
      db,
    );
    await sql`INSERT INTO chat_sessions (workspace_key, thread_key, session_id) VALUES ('admin@test.com', '', 'sess-1')`.execute(
      db,
    );

    await up(db);

    const users = await sql<{ id: string }>`SELECT id FROM users`.execute(db);
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0].id).toBe("existing-uuid");

    const sessions = await sql<{ workspace_key: string }>`SELECT workspace_key FROM chat_sessions`.execute(db);
    expect(sessions.rows[0].workspace_key).toBe("existing-uuid");
  });

  it("does nothing when no settings row exists", async () => {
    await up(db);

    const users = await sql<{ id: string }>`SELECT id FROM users`.execute(db);
    expect(users.rows).toHaveLength(0);
  });

  it("does nothing when admin_email is null", async () => {
    await sql`INSERT INTO settings (id, admin_email) VALUES ('default', NULL)`.execute(db);

    await up(db);

    const users = await sql<{ id: string }>`SELECT id FROM users`.execute(db);
    expect(users.rows).toHaveLength(0);
  });
});
