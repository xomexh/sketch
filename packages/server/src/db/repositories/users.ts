import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../schema";

export function createUserRepository(db: Kysely<DB>) {
  return {
    async list() {
      return db.selectFrom("users").selectAll().orderBy("created_at", "desc").execute();
    },

    async findBySlackId(slackUserId: string) {
      return db.selectFrom("users").selectAll().where("slack_user_id", "=", slackUserId).executeTakeFirst();
    },

    async findByWhatsappNumber(whatsappNumber: string) {
      return db.selectFrom("users").selectAll().where("whatsapp_number", "=", whatsappNumber).executeTakeFirst();
    },

    async findByEmail(email: string) {
      return db.selectFrom("users").selectAll().where("email", "=", email).executeTakeFirst();
    },

    async findById(id: string) {
      return db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
    },

    async create(data: {
      name: string;
      slackUserId?: string;
      whatsappNumber?: string;
      email?: string | null;
      emailVerified?: boolean;
    }) {
      const id = randomUUID();
      await db
        .insertInto("users")
        .values({
          id,
          name: data.name,
          slack_user_id: data.slackUserId ?? null,
          whatsapp_number: data.whatsappNumber ?? null,
          email: data.email ?? null,
          email_verified_at: data.email && data.emailVerified ? new Date().toISOString() : null,
        })
        .execute();

      return db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    },

    async update(
      id: string,
      data: {
        name?: string;
        email?: string | null;
        emailVerified?: boolean;
        whatsappNumber?: string | null;
        slackUserId?: string | null;
      },
    ) {
      const values: Record<string, unknown> = {};
      if (data.name !== undefined) values.name = data.name;
      if (data.email !== undefined) {
        values.email = data.email;
        if (data.emailVerified) {
          values.email_verified_at = new Date().toISOString();
        } else {
          // Reset verification when email changes
          const existing = await db.selectFrom("users").select("email").where("id", "=", id).executeTakeFirst();
          if (existing && existing.email !== data.email) {
            values.email_verified_at = null;
          }
        }
      } else if (data.emailVerified) {
        values.email_verified_at = new Date().toISOString();
      }
      if (data.whatsappNumber !== undefined) values.whatsapp_number = data.whatsappNumber;
      if (data.slackUserId !== undefined) values.slack_user_id = data.slackUserId;

      if (Object.keys(values).length > 0) {
        await db.updateTable("users").set(values).where("id", "=", id).execute();
      }

      return db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    },

    async remove(id: string) {
      return db.deleteFrom("users").where("id", "=", id).execute();
    },
  };
}
