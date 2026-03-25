import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("agent_runs")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("user_id", "text")
    .addColumn("platform", "text", (col) => col.notNull())
    .addColumn("context_type", "text", (col) => col.notNull())
    .addColumn("workspace_key", "text", (col) => col.notNull())
    .addColumn("thread_key", "text")
    .addColumn("channel_type", "text")
    .addColumn("session_id", "text")
    .addColumn("is_resumed_session", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("cost_usd", "real", (col) => col.notNull().defaultTo(0))
    .addColumn("duration_ms", "integer")
    .addColumn("duration_api_ms", "integer")
    .addColumn("num_turns", "integer")
    .addColumn("stop_reason", "text")
    .addColumn("error_subtype", "text")
    .addColumn("is_error", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("message_sent", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("input_tokens", "integer")
    .addColumn("output_tokens", "integer")
    .addColumn("cache_read_tokens", "integer")
    .addColumn("cache_creation_tokens", "integer")
    .addColumn("web_search_requests", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("web_fetch_requests", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("model", "text")
    .addColumn("total_attachments", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("image_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("non_image_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("mime_types", "text")
    .addColumn("file_sizes", "text")
    .addColumn("prompt_mode", "text")
    .addColumn("pending_uploads", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("buffered_message_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("inter_message_intervals", "text")
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema.createIndex("idx_agent_runs_user_id").on("agent_runs").columns(["user_id"]).execute();
  await db.schema.createIndex("idx_agent_runs_created_at").on("agent_runs").columns(["created_at"]).execute();
  await db.schema
    .createIndex("idx_agent_runs_user_created")
    .on("agent_runs")
    .columns(["user_id", "created_at"])
    .execute();

  await db.schema
    .createTable("tool_calls")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("agent_run_id", "text", (col) => col.notNull().references("agent_runs.id").onDelete("cascade"))
    .addColumn("tool_name", "text", (col) => col.notNull())
    .addColumn("skill_name", "text")
    .addColumn("outcome", "text")
    .addColumn("denial_reason", "text")
    .addColumn("is_mcp", "integer")
    .addColumn("mcp_server", "text")
    .addColumn("app_slug", "text")
    .addColumn("component_key", "text")
    .addColumn("component_type", "text")
    .addColumn("auth_type", "text")
    .addColumn("execution_outcome", "text")
    .execute();

  await db.schema.createIndex("idx_tool_calls_run_id").on("tool_calls").columns(["agent_run_id"]).execute();
  await db.schema.createIndex("idx_tool_calls_tool_name").on("tool_calls").columns(["tool_name"]).execute();
  await db.schema.createIndex("idx_tool_calls_skill").on("tool_calls").columns(["skill_name"]).execute();
  await db.schema.createIndex("idx_tool_calls_app_slug").on("tool_calls").columns(["app_slug"]).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("tool_calls").execute();
  await db.schema.dropTable("agent_runs").execute();
}
