/**
 * Tests for the 025-agent-usage migration.
 *
 * Uses a fresh blank in-memory SQLite database with no prerequisites (agent_runs
 * and tool_calls are new tables created by this migration). Tests verify that both
 * tables are created with correct columns and defaults, that FK cascade works,
 * that indexes exist, and that down() drops everything cleanly.
 */
import SQLite from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { down, up } from "./025-agent-usage";

type AgentRunRow = {
  id: string;
  user_id: string | null;
  platform: string;
  context_type: string;
  workspace_key: string;
  thread_key: string | null;
  channel_type: string | null;
  session_id: string | null;
  is_resumed_session: number;
  cost_usd: number;
  duration_ms: number | null;
  duration_api_ms: number | null;
  num_turns: number | null;
  stop_reason: string | null;
  error_subtype: string | null;
  is_error: number;
  message_sent: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  web_search_requests: number;
  web_fetch_requests: number;
  model: string | null;
  total_attachments: number;
  image_count: number;
  non_image_count: number;
  mime_types: string | null;
  file_sizes: string | null;
  prompt_mode: string | null;
  pending_uploads: number;
  buffered_message_count: number;
  inter_message_intervals: string | null;
  created_at: string;
};

type ToolCallRow = {
  id: number;
  agent_run_id: string;
  tool_name: string;
  skill_name: string | null;
  outcome: string | null;
  denial_reason: string | null;
  is_mcp: number | null;
  mcp_server: string | null;
  app_slug: string | null;
  component_key: string | null;
  component_type: string | null;
  auth_type: string | null;
  execution_outcome: string | null;
};

function createBlankDb(): Kysely<unknown> {
  return new Kysely<unknown>({
    dialect: new SqliteDialect({ database: new SQLite(":memory:") }),
  });
}

describe("025-agent-usage migration", () => {
  let db: Kysely<unknown>;

  beforeEach(async () => {
    db = createBlankDb();
    await up(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("creates agent_runs table and allows inserting a row", async () => {
    await (
      db as Kysely<{
        agent_runs: Partial<AgentRunRow> & {
          id: string;
          platform: string;
          context_type: string;
          workspace_key: string;
        };
      }>
    )
      .insertInto("agent_runs")
      .values({
        id: "run-001",
        platform: "slack",
        context_type: "dm",
        workspace_key: "user-123",
      })
      .execute();

    const rows = await (db as Kysely<{ agent_runs: AgentRunRow }>).selectFrom("agent_runs").selectAll().execute();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("run-001");
    expect(rows[0].platform).toBe("slack");
    expect(rows[0].context_type).toBe("dm");
    expect(rows[0].workspace_key).toBe("user-123");
  });

  it("defaults is_error=0, is_resumed_session=0, message_sent=0, cost_usd=0", async () => {
    await (
      db as Kysely<{
        agent_runs: Partial<AgentRunRow> & {
          id: string;
          platform: string;
          context_type: string;
          workspace_key: string;
        };
      }>
    )
      .insertInto("agent_runs")
      .values({
        id: "run-defaults",
        platform: "whatsapp",
        context_type: "channel_mention",
        workspace_key: "wa-group-123",
      })
      .execute();

    const rows = await (db as Kysely<{ agent_runs: AgentRunRow }>).selectFrom("agent_runs").selectAll().execute();

    expect(rows[0].is_error).toBe(0);
    expect(rows[0].is_resumed_session).toBe(0);
    expect(rows[0].message_sent).toBe(0);
    expect(rows[0].cost_usd).toBe(0);
    expect(rows[0].web_search_requests).toBe(0);
    expect(rows[0].web_fetch_requests).toBe(0);
    expect(rows[0].total_attachments).toBe(0);
    expect(rows[0].image_count).toBe(0);
    expect(rows[0].non_image_count).toBe(0);
    expect(rows[0].pending_uploads).toBe(0);
    expect(rows[0].buffered_message_count).toBe(0);
    expect(rows[0].created_at).toBeDefined();
  });

  it("nullable columns accept null", async () => {
    await (
      db as Kysely<{
        agent_runs: Partial<AgentRunRow> & {
          id: string;
          platform: string;
          context_type: string;
          workspace_key: string;
        };
      }>
    )
      .insertInto("agent_runs")
      .values({
        id: "run-nulls",
        user_id: null,
        platform: "slack",
        context_type: "dm",
        workspace_key: "user-456",
        thread_key: null,
        session_id: null,
        model: null,
        stop_reason: null,
        error_subtype: null,
      })
      .execute();

    const rows = await (db as Kysely<{ agent_runs: AgentRunRow }>).selectFrom("agent_runs").selectAll().execute();

    expect(rows[0].user_id).toBeNull();
    expect(rows[0].thread_key).toBeNull();
    expect(rows[0].session_id).toBeNull();
    expect(rows[0].model).toBeNull();
    expect(rows[0].stop_reason).toBeNull();
    expect(rows[0].error_subtype).toBeNull();
  });

  it("creates tool_calls table and allows inserting rows", async () => {
    await (
      db as Kysely<{
        agent_runs: Partial<AgentRunRow> & {
          id: string;
          platform: string;
          context_type: string;
          workspace_key: string;
        };
      }>
    )
      .insertInto("agent_runs")
      .values({ id: "run-tools", platform: "slack", context_type: "dm", workspace_key: "user-789" })
      .execute();

    await (db as Kysely<{ tool_calls: Omit<ToolCallRow, "id"> }>)
      .insertInto("tool_calls")
      .values([
        { agent_run_id: "run-tools", tool_name: "Bash", skill_name: null },
        { agent_run_id: "run-tools", tool_name: "Skill", skill_name: "canvas" },
        { agent_run_id: "run-tools", tool_name: "mcp__plugin_pipedream__execute", skill_name: null },
      ])
      .execute();

    const rows = await (db as Kysely<{ tool_calls: ToolCallRow }>).selectFrom("tool_calls").selectAll().execute();

    expect(rows).toHaveLength(3);
    expect(rows[0].tool_name).toBe("Bash");
    expect(rows[0].skill_name).toBeNull();
    expect(rows[1].tool_name).toBe("Skill");
    expect(rows[1].skill_name).toBe("canvas");
  });

  it("tool_calls Phase 3 columns default to null", async () => {
    await (
      db as Kysely<{
        agent_runs: Partial<AgentRunRow> & {
          id: string;
          platform: string;
          context_type: string;
          workspace_key: string;
        };
      }>
    )
      .insertInto("agent_runs")
      .values({ id: "run-p3", platform: "slack", context_type: "dm", workspace_key: "user-p3" })
      .execute();

    await (db as Kysely<{ tool_calls: Omit<ToolCallRow, "id"> }>)
      .insertInto("tool_calls")
      .values({ agent_run_id: "run-p3", tool_name: "Read", skill_name: null })
      .execute();

    const rows = await (db as Kysely<{ tool_calls: ToolCallRow }>).selectFrom("tool_calls").selectAll().execute();

    expect(rows[0].outcome).toBeNull();
    expect(rows[0].denial_reason).toBeNull();
    expect(rows[0].is_mcp).toBeNull();
    expect(rows[0].mcp_server).toBeNull();
    expect(rows[0].app_slug).toBeNull();
    expect(rows[0].component_key).toBeNull();
    expect(rows[0].component_type).toBeNull();
    expect(rows[0].auth_type).toBeNull();
    expect(rows[0].execution_outcome).toBeNull();
  });

  it("FK cascade: deleting agent_run deletes its tool_calls", async () => {
    await (
      db as Kysely<{
        agent_runs: Partial<AgentRunRow> & {
          id: string;
          platform: string;
          context_type: string;
          workspace_key: string;
        };
      }>
    )
      .insertInto("agent_runs")
      .values({ id: "run-cascade", platform: "slack", context_type: "dm", workspace_key: "user-cascade" })
      .execute();

    await (db as Kysely<{ tool_calls: Omit<ToolCallRow, "id"> }>)
      .insertInto("tool_calls")
      .values([
        { agent_run_id: "run-cascade", tool_name: "Bash", skill_name: null },
        { agent_run_id: "run-cascade", tool_name: "Read", skill_name: null },
      ])
      .execute();

    // Enable FK enforcement (SQLite requires this per-connection)
    await sql`PRAGMA foreign_keys = ON`.execute(db);

    await (db as Kysely<{ agent_runs: AgentRunRow }>)
      .deleteFrom("agent_runs")
      .where("id", "=", "run-cascade")
      .execute();

    const remaining = await (db as Kysely<{ tool_calls: ToolCallRow }>).selectFrom("tool_calls").selectAll().execute();
    expect(remaining).toHaveLength(0);
  });

  it("indexes exist on agent_runs and tool_calls", async () => {
    const indexes = await sql<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name
    `.execute(db);

    const names = indexes.rows.map((r) => r.name);
    expect(names).toContain("idx_agent_runs_user_id");
    expect(names).toContain("idx_agent_runs_created_at");
    expect(names).toContain("idx_agent_runs_user_created");
    expect(names).toContain("idx_tool_calls_run_id");
    expect(names).toContain("idx_tool_calls_tool_name");
    expect(names).toContain("idx_tool_calls_skill");
    expect(names).toContain("idx_tool_calls_app_slug");
  });

  it("tool_calls.id auto-increments", async () => {
    await (
      db as Kysely<{
        agent_runs: Partial<AgentRunRow> & {
          id: string;
          platform: string;
          context_type: string;
          workspace_key: string;
        };
      }>
    )
      .insertInto("agent_runs")
      .values({ id: "run-autoinc", platform: "slack", context_type: "dm", workspace_key: "user-autoinc" })
      .execute();

    await (db as Kysely<{ tool_calls: Omit<ToolCallRow, "id"> }>)
      .insertInto("tool_calls")
      .values([
        { agent_run_id: "run-autoinc", tool_name: "Bash", skill_name: null },
        { agent_run_id: "run-autoinc", tool_name: "Read", skill_name: null },
      ])
      .execute();

    const rows = await (db as Kysely<{ tool_calls: ToolCallRow }>)
      .selectFrom("tool_calls")
      .selectAll()
      .orderBy("id", "asc")
      .execute();

    expect(rows[0].id).toBeLessThan(rows[1].id);
  });

  it("down() drops both tables", async () => {
    await down(db);

    const tables = await sql<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_runs', 'tool_calls')
    `.execute(db);

    expect(tables.rows).toHaveLength(0);
  });
});
