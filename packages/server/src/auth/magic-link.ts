import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema";

const TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Find a user by email who has a verified email address.
 * Used by the magic link request route — keeps user lookup in the auth module.
 */
export async function findVerifiedUserByEmail(
  db: Kysely<DB>,
  email: string,
): Promise<{ id: string; name: string; email: string } | null> {
  const user = await db
    .selectFrom("users")
    .select(["id", "name", "email"])
    .where("email", "=", email)
    .where("email_verified_at", "is not", null)
    .executeTakeFirst();

  return user?.email ? { id: user.id, name: user.name, email: user.email } : null;
}

export async function createMagicLinkToken(db: Kysely<DB>, userId: string): Promise<string> {
  // Clean up expired tokens for this user
  await db
    .deleteFrom("magic_link_tokens")
    .where("user_id", "=", userId)
    .where("expires_at", "<", new Date().toISOString())
    .execute();

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString();

  await db
    .insertInto("magic_link_tokens")
    .values({ token, user_id: userId, expires_at: expiresAt, created_at: new Date().toISOString() })
    .execute();

  return token;
}

/**
 * Verify a magic link token. Uses an atomic UPDATE to prevent double-use race conditions —
 * the UPDATE marks the token as used and checks validity in a single query. Only if a row
 * was actually updated do we proceed to return the user_id.
 */
export async function verifyMagicLinkToken(db: Kysely<DB>, token: string): Promise<string | null> {
  const result = await db
    .updateTable("magic_link_tokens")
    .set({ used_at: new Date().toISOString() })
    .where("token", "=", token)
    .where("used_at", "is", null)
    .where("expires_at", ">", new Date().toISOString())
    .executeTakeFirst();

  if (!result.numUpdatedRows) return null;

  // Token was successfully claimed — now read the user_id
  const row = await db.selectFrom("magic_link_tokens").select("user_id").where("token", "=", token).executeTakeFirst();

  return row?.user_id ?? null;
}

export async function countRecentMagicLinkTokens(db: Kysely<DB>, userId: string): Promise<number> {
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const result = await db
    .selectFrom("magic_link_tokens")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("user_id", "=", userId)
    .where("created_at", ">", fifteenMinAgo)
    .executeTakeFirstOrThrow();

  return result.count;
}
