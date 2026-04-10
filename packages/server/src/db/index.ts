import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import pino from "pino";
import type { Config } from "../config";
import type { DB } from "./schema";

/** Embedding dimensions by provider. Used when creating vec0 virtual tables. */
export const EMBEDDING_DIMENSIONS = 3072;

/**
 * Whether sqlite-vec was successfully loaded on the last createDatabase() call.
 * Search falls back to FTS-only when false.
 */
export let sqliteVecAvailable = false;

/**
 * Creates and returns a Kysely database instance for the configured dialect (SQLite or Postgres).
 * @remarks
 * For SQLite, WAL mode and foreign keys are enabled, and the sqlite-vec extension is loaded
 * for vector search. The extension is treated as optional — when unavailable, search falls
 * back to FTS-only and embedding operations are skipped.
 *
 * The vec0 virtual tables (`chunk_embeddings`, `file_embeddings`) are created outside Kysely
 * migrations because they require the sqlite-vec extension to be loaded first. If the embedding
 * dimensions have changed (detected by inspecting the existing CREATE statement), the tables are
 * dropped and recreated and all file embedding statuses are reset to `pending` so enrichment
 * re-runs with the new dimensions.
 */
export async function createDatabase(config: Config): Promise<Kysely<DB>> {
  if (config.DB_TYPE === "postgres") {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: config.DATABASE_URL, max: 5, ssl: { rejectUnauthorized: false } });
    return new Kysely<DB>({
      dialect: new PostgresDialect({ pool }),
    });
  }

  const logger = pino({ level: "warn" });
  const Database = (await import("better-sqlite3")).default;
  mkdirSync(dirname(config.SQLITE_PATH), { recursive: true });
  const sqlite = new Database(config.SQLITE_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  try {
    const sqliteVec = await import("sqlite-vec");
    sqliteVec.load(sqlite);
    sqliteVecAvailable = true;

    for (const table of ["chunk_embeddings", "file_embeddings"] as const) {
      const pk = table === "chunk_embeddings" ? "chunk_id" : "indexed_file_id";
      const existingDef = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as
        | { sql: string }
        | undefined;

      if (existingDef) {
        const dimMatch = existingDef.sql.match(/float\[(\d+)\]/);
        if (dimMatch && Number(dimMatch[1]) !== EMBEDDING_DIMENSIONS) {
          sqlite.exec(`DROP TABLE ${table}`);
          sqlite.exec(
            `UPDATE indexed_files SET embedding_status = 'pending' WHERE embedding_status IN ('done', 'processing')`,
          );
        } else {
          continue;
        }
      }

      sqlite.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(
          ${pk} TEXT PRIMARY KEY,
          embedding float[${EMBEDDING_DIMENSIONS}]
        )
      `);
    }
  } catch (err) {
    sqliteVecAvailable = false;
    logger.warn({ err }, "sqlite-vec extension unavailable — vector search disabled, falling back to FTS-only");
  }

  return new Kysely<DB>({
    dialect: new SqliteDialect({ database: sqlite }),
  });
}
