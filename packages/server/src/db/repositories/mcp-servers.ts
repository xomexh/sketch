/**
 * MCP servers repository.
 * CRUD operations for the unified mcp_servers table which holds both
 * plain MCP servers (type = null) and integration providers (type = 'canvas', etc.).
 * Slug is auto-generated from display_name with collision avoidance.
 */
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../schema";

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createMcpServerRepository(db: Kysely<DB>) {
  async function uniqueSlug(name: string): Promise<string> {
    const base = generateSlug(name);
    const existing = await db.selectFrom("mcp_servers").select("slug").where("slug", "=", base).executeTakeFirst();
    if (!existing) return base;

    let counter = 2;
    while (true) {
      const candidate = `${base}-${counter}`;
      const taken = await db.selectFrom("mcp_servers").select("slug").where("slug", "=", candidate).executeTakeFirst();
      if (!taken) return candidate;
      counter++;
    }
  }

  return {
    async listAll() {
      return db.selectFrom("mcp_servers").selectAll().orderBy("created_at", "asc").execute();
    },

    async getById(id: string) {
      return (await db.selectFrom("mcp_servers").selectAll().where("id", "=", id).executeTakeFirst()) ?? null;
    },

    async getBySlug(slug: string) {
      return (await db.selectFrom("mcp_servers").selectAll().where("slug", "=", slug).executeTakeFirst()) ?? null;
    },

    async findIntegrationProvider() {
      return (
        (await db
          .selectFrom("mcp_servers")
          .selectAll()
          .where("type", "is not", null)
          .orderBy("created_at", "asc")
          .executeTakeFirst()) ?? null
      );
    },

    async create(data: {
      type?: string | null;
      displayName: string;
      url: string;
      apiUrl?: string | null;
      credentials: string;
    }) {
      const id = randomUUID();
      const slug = await uniqueSlug(data.displayName);

      await db
        .insertInto("mcp_servers")
        .values({
          id,
          type: data.type ?? null,
          slug,
          display_name: data.displayName,
          url: data.url,
          api_url: data.apiUrl ?? null,
          credentials: data.credentials,
        })
        .execute();

      return db.selectFrom("mcp_servers").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    },

    async update(
      id: string,
      data: Partial<{ displayName: string; url: string; apiUrl: string | null; credentials: string }>,
    ) {
      const updates: Record<string, string | null> = {};
      if (data.displayName !== undefined) updates.display_name = data.displayName;
      if (data.url !== undefined) updates.url = data.url;
      if (data.apiUrl !== undefined) updates.api_url = data.apiUrl;
      if (data.credentials !== undefined) updates.credentials = data.credentials;

      if (Object.keys(updates).length === 0) return;

      await db.updateTable("mcp_servers").set(updates).where("id", "=", id).execute();
    },

    async remove(id: string) {
      await db.deleteFrom("mcp_servers").where("id", "=", id).execute();
    },
  };
}

export { generateSlug };
