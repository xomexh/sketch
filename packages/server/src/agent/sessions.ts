/**
 * Persists the Claude Agent SDK session ID per workspace (and optionally per thread) in the DB.
 *
 * DMs and group chats use a single workspace-level row (thread_key IS NULL).
 * Channel mentions use per-thread rows (thread_key = threadTs) so threads don't
 * bleed into each other. The workspace_key is the directory name under workspaces/:
 * a user ID for DMs, "channel-{channelId}" for Slack channels, or "wa-group-{jid}"
 * for WhatsApp groups.
 *
 * UPSERT uses a raw INSERT ... ON CONFLICT DO UPDATE targeting the named expression
 * index "chat_sessions_workspace_thread_uidx" (on workspace_key, COALESCE(thread_key, '')).
 * Kysely's typed onConflict() builder does not support expression-based index targets,
 * so we fall back to sql`` for the upsert statement only.
 */
import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema";

export async function getSessionId(
  db: Kysely<DB>,
  workspaceKey: string,
  threadKey?: string,
): Promise<string | undefined> {
  const row = await db
    .selectFrom("chat_sessions")
    .select("session_id")
    .where("workspace_key", "=", workspaceKey)
    .where("thread_key", threadKey !== undefined ? "=" : "is", threadKey ?? null)
    .executeTakeFirst();
  return row?.session_id;
}

export async function saveSessionId(
  db: Kysely<DB>,
  workspaceKey: string,
  sessionId: string,
  threadKey?: string,
): Promise<void> {
  await sql`
    INSERT INTO chat_sessions (workspace_key, thread_key, session_id)
    VALUES (${workspaceKey}, ${threadKey ?? null}, ${sessionId})
    ON CONFLICT (workspace_key, COALESCE(thread_key, ''))
    DO UPDATE SET session_id = excluded.session_id, updated_at = CURRENT_TIMESTAMP
  `.execute(db);
}
