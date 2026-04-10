import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db/schema";
import { createTestDb } from "../test-utils";
import { browseFiles, searchFiles } from "./search";

async function insertFile(db: Kysely<DB>, id: string, sourcePath: string, source = "google_drive") {
  await db
    .insertInto("indexed_files")
    .values({
      id,
      connector_config_id: "connector-1",
      provider_file_id: id,
      file_name: `${id}.txt`,
      file_type: "text",
      content_category: "document",
      source,
      source_path: sourcePath,
      provider_url: null,
      content: null,
      summary: null,
      context_note: null,
      tags: null,
      access_scope_id: null,
      source_updated_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    })
    .execute();
}

describe("browseFiles — LIKE wildcard escaping", () => {
  let db: Kysely<DB>;

  beforeEach(async () => {
    db = await createTestDb();
    await db
      .insertInto("connector_configs")
      .values({
        id: "connector-1",
        connector_type: "google_drive",
        auth_type: "oauth",
        credentials: "{}",
        created_by: "admin",
      })
      .execute();
  });

  afterEach(async () => {
    try {
      await db.destroy();
    } catch {}
  });

  it("% in folderPath matches only paths containing a literal percent sign, not all paths", async () => {
    await insertFile(db, "file-percent", "My Drive / 100% Done");
    await insertFile(db, "file-normal", "My Drive / Regular Folder");

    const results = await browseFiles(db, { folderPath: "100%" });

    const ids = results.map((r) => r.id);
    expect(ids).toContain("file-percent");
    expect(ids).not.toContain("file-normal");
  });

  it("_ in folderPath matches only paths containing a literal underscore, not any single character", async () => {
    await insertFile(db, "file-underscore", "My Drive / Project_Alpha");
    await insertFile(db, "file-no-underscore", "My Drive / ProjectBAlpha");

    const results = await browseFiles(db, { folderPath: "Project_Alpha" });

    const ids = results.map((r) => r.id);
    expect(ids).toContain("file-underscore");
    expect(ids).not.toContain("file-no-underscore");
  });

  it("a bare % folderPath does not return all files", async () => {
    await insertFile(db, "file-a", "My Drive / FolderA");
    await insertFile(db, "file-b", "My Drive / FolderB");

    const results = await browseFiles(db, { folderPath: "%" });

    expect(results).toHaveLength(0);
  });
});

describe("searchFiles — FTS5 query sanitization", () => {
  let db: Kysely<DB>;

  beforeEach(async () => {
    db = await createTestDb();
    await db
      .insertInto("connector_configs")
      .values({
        id: "connector-2",
        connector_type: "google_drive",
        auth_type: "oauth",
        credentials: "{}",
        created_by: "admin",
      })
      .execute();
    await db
      .insertInto("indexed_files")
      .values({
        id: "file-fts",
        connector_config_id: "connector-2",
        provider_file_id: "fts-provider",
        file_name: "planning.txt",
        file_type: "text",
        content_category: "document",
        source: "google_drive",
        source_path: "My Drive / Docs",
        provider_url: null,
        content: "quarterly planning document for Q1 2025",
        summary: null,
        context_note: null,
        tags: null,
        access_scope_id: null,
        source_updated_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      })
      .execute();
  });

  afterEach(async () => {
    try {
      await db.destroy();
    } catch {}
  });

  it("a query with FTS5 special characters does not throw", async () => {
    const specialQueries = [
      "planning*",
      "(planning)",
      '"planning"',
      "planning OR",
      "planning AND",
      "NOT planning",
      "plan+ning",
      "plan-ning",
      "NEAR(planning doc)",
    ];

    for (const query of specialQueries) {
      await expect(searchFiles(db, query)).resolves.not.toThrow();
    }
  });

  it("a normal query still returns matching results", async () => {
    const results = await searchFiles(db, "planning");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].fileName).toBe("planning.txt");
  });

  it("an empty or all-special-chars query returns empty array without throwing", async () => {
    await expect(searchFiles(db, "   ")).resolves.toEqual([]);
    await expect(searchFiles(db, "***")).resolves.toBeInstanceOf(Array);
  });
});
