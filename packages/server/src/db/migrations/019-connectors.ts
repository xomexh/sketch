/**
 * Connectors and indexed files infrastructure.
 *
 * **connector_configs**: `connector_type` (e.g. google_drive, clickup, notion, linear), `auth_type`
 * (oauth, api_key, integration_token), encrypted `credentials` JSON, `scope_config` for folder/space filters,
 * `sync_status` / `sync_cursor` for incremental sync.
 *
 * **indexed_files**: provider file metadata, `file_type`, `content_category` (document vs structured),
 * `content` / `summary` / `tags` JSON, `source`, `source_path`, `content_hash`, enrichment and embedding columns.
 * Indexes on connector, provider identity, and archive flag.
 *
 * **Postgres**: generated `search_vector` + GIN index. **SQLite**: FTS5 virtual table `indexed_files_fts`
 * over name, summary, tags, source, source_path, with insert/update/delete triggers.
 */
import { type Kysely, sql } from "kysely";
import { isPg } from "../dialect";

export async function up(db: Kysely<unknown>): Promise<void> {
  const isPostgres = isPg(db);

  await db.schema
    .createTable("connector_configs")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("connector_type", "text", (col) => col.notNull())
    .addColumn("auth_type", "text", (col) => col.notNull())
    .addColumn("credentials", "text", (col) => col.notNull())
    .addColumn("scope_config", "text", (col) => col.notNull().defaultTo("{}"))
    .addColumn("sync_status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("sync_cursor", "text")
    .addColumn("last_synced_at", "text")
    .addColumn("error_message", "text")
    .addColumn("created_by", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("updated_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable("indexed_files")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("connector_config_id", "text", (col) =>
      col.notNull().references("connector_configs.id").onDelete("cascade"),
    )
    .addColumn("provider_file_id", "text", (col) => col.notNull())
    .addColumn("provider_url", "text")
    .addColumn("file_name", "text", (col) => col.notNull())
    .addColumn("file_type", "text")
    .addColumn("content_category", "text", (col) => col.notNull())
    .addColumn("content", "text")
    .addColumn("summary", "text")
    .addColumn("tags", "text")
    .addColumn("source", "text", (col) => col.notNull())
    .addColumn("source_path", "text")
    .addColumn("content_hash", "text")
    .addColumn("is_archived", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("source_created_at", "text")
    .addColumn("source_updated_at", "text")
    .addColumn("synced_at", "text", (col) => col.notNull())
    .addColumn("indexed_at", "text", (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addColumn("context_note", "text")
    .addColumn("enrichment_status", "text", (col) => col.notNull().defaultTo("raw"))
    .addColumn("access_scope_id", "text")
    .addColumn("mime_type", "text")
    .addColumn("embedding_status", "text", (col) => col.defaultTo("pending"))
    .execute();

  await db.schema
    .createIndex("idx_indexed_files_connector")
    .on("indexed_files")
    .columns(["connector_config_id"])
    .execute();

  await db.schema
    .createIndex("idx_indexed_files_provider")
    .on("indexed_files")
    .columns(["source", "provider_file_id"])
    .execute();

  await db.schema.createIndex("idx_indexed_files_not_archived").on("indexed_files").columns(["is_archived"]).execute();

  if (isPostgres) {
    await sql`ALTER TABLE indexed_files ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
      to_tsvector('english',
        regexp_replace(coalesce(file_name, ''), '[._\\-/]', ' ', 'g') || ' ' ||
        coalesce(summary, '') || ' ' ||
        coalesce(tags, '') || ' ' ||
        coalesce(source, '') || ' ' ||
        coalesce(source_path, '')
      )
    ) STORED`.execute(db);

    await sql`CREATE INDEX idx_indexed_files_search_vector ON indexed_files USING GIN (search_vector)`.execute(db);
    return;
  }

  await sql`
		CREATE VIRTUAL TABLE indexed_files_fts USING fts5(
			file_name,
			summary,
			tags,
			source,
			source_path,
			content='indexed_files',
			content_rowid='rowid'
		)
	`.execute(db);

  await sql`
		CREATE TRIGGER indexed_files_ai AFTER INSERT ON indexed_files BEGIN
			INSERT INTO indexed_files_fts(rowid, file_name, summary, tags, source, source_path)
			VALUES (new.rowid, new.file_name, new.summary, new.tags, new.source, new.source_path);
		END
	`.execute(db);

  await sql`
		CREATE TRIGGER indexed_files_ad AFTER DELETE ON indexed_files BEGIN
			INSERT INTO indexed_files_fts(indexed_files_fts, rowid, file_name, summary, tags, source, source_path)
			VALUES ('delete', old.rowid, old.file_name, old.summary, old.tags, old.source, old.source_path);
		END
	`.execute(db);

  await sql`
		CREATE TRIGGER indexed_files_au AFTER UPDATE ON indexed_files BEGIN
			INSERT INTO indexed_files_fts(indexed_files_fts, rowid, file_name, summary, tags, source, source_path)
			VALUES ('delete', old.rowid, old.file_name, old.summary, old.tags, old.source, old.source_path);
			INSERT INTO indexed_files_fts(rowid, file_name, summary, tags, source, source_path)
			VALUES (new.rowid, new.file_name, new.summary, new.tags, new.source, new.source_path);
		END
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const isPostgres = isPg(db);

  if (!isPostgres) {
    await sql`DROP TRIGGER IF EXISTS indexed_files_au`.execute(db);
    await sql`DROP TRIGGER IF EXISTS indexed_files_ad`.execute(db);
    await sql`DROP TRIGGER IF EXISTS indexed_files_ai`.execute(db);
    await sql`DROP TABLE IF EXISTS indexed_files_fts`.execute(db);
  }

  await db.schema.dropTable("indexed_files").execute();
  await db.schema.dropTable("connector_configs").execute();
}
