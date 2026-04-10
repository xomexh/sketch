import { randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../db/schema";

/** Tokens expire after 24 hours; after expiry the user must request a new verification email. */
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Creates a new email verification token for the given user+email pair.
 * Any prior unused tokens for the user are invalidated, and expired rows are deleted.
 */
export async function createVerificationToken(db: Kysely<DB>, userId: string, email: string): Promise<string> {
  await db
    .updateTable("email_verification_tokens")
    .set({ used_at: new Date().toISOString() })
    .where("user_id", "=", userId)
    .where("used_at", "is", null)
    .execute();

  await db
    .deleteFrom("email_verification_tokens")
    .where("user_id", "=", userId)
    .where("expires_at", "<", new Date().toISOString())
    .execute();

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString();

  await db
    .insertInto("email_verification_tokens")
    .values({ token, user_id: userId, email, expires_at: expiresAt, created_at: new Date().toISOString() })
    .execute();

  return token;
}

/**
 * Verifies a token and, if valid, marks it as used and sets `email_verified_at` on the user.
 *
 * Returns the resolved `{ userId, email }` on success, or `null` when the token is
 * invalid, expired, already used, or the user's email has changed since the token was issued.
 */
export async function verifyEmailToken(
  db: Kysely<DB>,
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const row = await db
    .selectFrom("email_verification_tokens")
    .selectAll()
    .where("token", "=", token)
    .where("used_at", "is", null)
    .where("expires_at", ">", new Date().toISOString())
    .executeTakeFirst();

  if (!row) return null;

  const user = await db.selectFrom("users").select("email").where("id", "=", row.user_id).executeTakeFirst();

  if (!user || user.email !== row.email) return null;

  await db
    .updateTable("email_verification_tokens")
    .set({ used_at: new Date().toISOString() })
    .where("token", "=", token)
    .execute();

  await db
    .updateTable("users")
    .set({ email_verified_at: new Date().toISOString() })
    .where("id", "=", row.user_id)
    .execute();

  return { userId: row.user_id, email: row.email };
}

/** Returns the number of verification tokens created for the user in the past hour (for rate limiting). */
export async function countRecentTokens(db: Kysely<DB>, userId: string): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const result = await db
    .selectFrom("email_verification_tokens")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("user_id", "=", userId)
    .where("created_at", ">", oneHourAgo)
    .executeTakeFirstOrThrow();

  return result.count;
}
