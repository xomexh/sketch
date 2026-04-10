/**
 * Normalize agent_runs.created_at from SQLite CURRENT_TIMESTAMP format ("YYYY-MM-DD HH:MM:SS")
 * to ISO 8601 format ("YYYY-MM-DDTHH:MM:SS.000Z").
 *
 * Root cause: the column defaults to CURRENT_TIMESTAMP which produces space-separated dates.
 * Period query bounds use ISO format. Because the column is text, comparisons are lexicographic,
 * and space (0x20) < T (0x54) causes rows on a period boundary date to be missed.
 *
 * `down` is a no-op: there is no schema change, and reverting timestamp formats is not useful once
 * the app writes ISO-8601 on insert.
 */
import { type Kysely, sql } from "kysely";
import { isPg } from "../dialect";

export async function up(db: Kysely<unknown>): Promise<void> {
  if (isPg(db)) {
    await sql`
      UPDATE agent_runs
      SET created_at = to_char(created_at::timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      WHERE created_at NOT LIKE '%T%'
    `.execute(db);
  } else {
    await sql`
      UPDATE agent_runs
      SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
      WHERE created_at NOT LIKE '%T%'
    `.execute(db);
  }
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
