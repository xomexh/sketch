/**
 * Repository for user_provider_identities table.
 * Maps Sketch users to their accounts in external providers (ClickUp, Google, etc.)
 * via per-user OAuth. Used at query time to resolve provider user IDs for
 * file_access filtering.
 */
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { ConnectorType } from "../../connectors/types";
import type { DB } from "../schema";

export function createProviderIdentityRepository(db: Kysely<DB>) {
  return {
    /** Find a user's identity for a specific provider. */
    async findByUserAndProvider(userId: string, provider: ConnectorType) {
      return db
        .selectFrom("user_provider_identities")
        .selectAll()
        .where("user_id", "=", userId)
        .where("provider", "=", provider)
        .executeTakeFirst();
    },

    /** Get all provider identities for a user. */
    async findByUser(userId: string) {
      return db
        .selectFrom("user_provider_identities")
        .selectAll()
        .where("user_id", "=", userId)
        .orderBy("connected_at", "desc")
        .execute();
    },

    /** Get all connected provider user IDs for a user (across all providers). */
    async getProviderUserIds(userId: string): Promise<string[]> {
      const rows = await db
        .selectFrom("user_provider_identities")
        .select("provider_user_id")
        .where("user_id", "=", userId)
        .execute();

      return rows.map((r) => r.provider_user_id);
    },

    /** Create or update a provider identity (upsert by user_id + provider). */
    async upsert(data: {
      userId: string;
      provider: ConnectorType;
      providerUserId: string;
      providerEmail?: string | null;
      accessToken?: string | null;
      refreshToken?: string | null;
      tokenExpiresAt?: string | null;
    }) {
      const existing = await this.findByUserAndProvider(data.userId, data.provider);

      if (existing) {
        const values: Record<string, unknown> = {
          provider_user_id: data.providerUserId,
        };
        if (data.providerEmail !== undefined) values.provider_email = data.providerEmail;
        if (data.accessToken !== undefined) values.access_token = data.accessToken;
        if (data.refreshToken !== undefined) values.refresh_token = data.refreshToken;
        if (data.tokenExpiresAt !== undefined) values.token_expires_at = data.tokenExpiresAt;

        await db.updateTable("user_provider_identities").set(values).where("id", "=", existing.id).execute();

        return db
          .selectFrom("user_provider_identities")
          .selectAll()
          .where("id", "=", existing.id)
          .executeTakeFirstOrThrow();
      }

      const id = randomUUID();
      await db
        .insertInto("user_provider_identities")
        .values({
          id,
          user_id: data.userId,
          provider: data.provider,
          provider_user_id: data.providerUserId,
          provider_email: data.providerEmail ?? null,
          access_token: data.accessToken ?? null,
          refresh_token: data.refreshToken ?? null,
          token_expires_at: data.tokenExpiresAt ?? null,
        })
        .execute();

      return db.selectFrom("user_provider_identities").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    },

    /** Remove a provider identity (disconnect). */
    async remove(userId: string, provider: ConnectorType) {
      await db
        .deleteFrom("user_provider_identities")
        .where("user_id", "=", userId)
        .where("provider", "=", provider)
        .execute();
    },

    /** List all identities for a provider (admin view). */
    async findByProvider(provider: ConnectorType) {
      return db.selectFrom("user_provider_identities").selectAll().where("provider", "=", provider).execute();
    },
  };
}
