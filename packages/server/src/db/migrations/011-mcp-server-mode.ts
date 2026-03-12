/**
 * Add mode column to mcp_servers.
 * Defaults to 'mcp'. Integration providers set to 'skill' are excluded from
 * buildMcpServers() so the agent uses the skill's own CLI transport instead.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("mcp_servers")
    .addColumn("mode", "text", (col) => col.notNull().defaultTo("mcp"))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("mcp_servers").dropColumn("mode").execute();
}
