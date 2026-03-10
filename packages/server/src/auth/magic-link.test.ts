import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUserRepository } from "../db/repositories/users";
import type { DB } from "../db/schema";
import { createTestDb } from "../test-utils";
import { createRateLimitedMagicLinkToken, findVerifiedUserByEmail, verifyMagicLinkToken } from "./magic-link";

let db: Kysely<DB>;
let users: ReturnType<typeof createUserRepository>;

beforeEach(async () => {
  db = await createTestDb();
  users = createUserRepository(db);
});

afterEach(async () => {
  await db.destroy();
});

async function createVerifiedUser(email: string) {
  const user = await users.create({ name: "Test User" });
  await users.update(user.id, { email });
  await db
    .updateTable("users")
    .set({ email_verified_at: new Date().toISOString() })
    .where("id", "=", user.id)
    .execute();
  return user;
}

async function createUnverifiedUser(email: string) {
  const user = await users.create({ name: "Unverified User" });
  await users.update(user.id, { email });
  return user;
}

describe("findVerifiedUserByEmail()", () => {
  it("returns user with verified email", async () => {
    const user = await createVerifiedUser("test@example.com");
    const result = await findVerifiedUserByEmail(db, "test@example.com");
    expect(result).toEqual({ id: user.id, name: "Test User", email: "test@example.com" });
  });

  it("matches case-insensitively (Postgres-safe)", async () => {
    const user = await createVerifiedUser("Test@Example.COM");
    const result = await findVerifiedUserByEmail(db, "test@example.com");
    expect(result).toEqual({ id: user.id, name: "Test User", email: "Test@Example.COM" });
  });

  it("returns null for unverified email", async () => {
    await createUnverifiedUser("test@example.com");
    const result = await findVerifiedUserByEmail(db, "test@example.com");
    expect(result).toBeNull();
  });

  it("returns null for unknown email", async () => {
    const result = await findVerifiedUserByEmail(db, "nobody@example.com");
    expect(result).toBeNull();
  });
});

describe("createRateLimitedMagicLinkToken()", () => {
  it("returns a 64-char hex token", async () => {
    const user = await createVerifiedUser("test@example.com");
    const token = await createRateLimitedMagicLinkToken(db, user.id);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores token in the database", async () => {
    const user = await createVerifiedUser("test@example.com");
    const token = await createRateLimitedMagicLinkToken(db, user.id);
    expect(token).not.toBeNull();

    const row = await db
      .selectFrom("magic_link_tokens")
      .selectAll()
      .where("token", "=", token as string)
      .executeTakeFirst();

    expect(row).toBeDefined();
    expect(row?.user_id).toBe(user.id);
    expect(row?.used_at).toBeNull();
  });

  it("cleans up expired tokens for the user", async () => {
    const user = await createVerifiedUser("test@example.com");

    await db
      .insertInto("magic_link_tokens")
      .values({
        token: "expired-token",
        user_id: user.id,
        expires_at: new Date(Date.now() - 1000).toISOString(),
        created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      })
      .execute();

    await createRateLimitedMagicLinkToken(db, user.id);

    const expired = await db
      .selectFrom("magic_link_tokens")
      .selectAll()
      .where("token", "=", "expired-token")
      .executeTakeFirst();

    expect(expired).toBeUndefined();
  });

  it("returns null when rate limit (5 per 15 min) is reached", async () => {
    const user = await createVerifiedUser("test@example.com");

    // Create 5 tokens (at the limit)
    for (let i = 0; i < 5; i++) {
      const t = await createRateLimitedMagicLinkToken(db, user.id);
      expect(t).not.toBeNull();
    }

    // 6th should be rate-limited
    const rateLimited = await createRateLimitedMagicLinkToken(db, user.id);
    expect(rateLimited).toBeNull();
  });

  it("does not count expired tokens from other users toward rate limit", async () => {
    const user1 = await createVerifiedUser("user1@example.com");
    const user2 = await createVerifiedUser("user2@example.com");

    // Fill user2's limit
    for (let i = 0; i < 5; i++) {
      await createRateLimitedMagicLinkToken(db, user2.id);
    }

    // user1 should still be able to create tokens
    const token = await createRateLimitedMagicLinkToken(db, user1.id);
    expect(token).not.toBeNull();
  });

  it("does not count old tokens toward rate limit", async () => {
    const user = await createVerifiedUser("test@example.com");

    // Insert 5 tokens with old timestamps (>15 min ago)
    for (let i = 0; i < 5; i++) {
      await db
        .insertInto("magic_link_tokens")
        .values({
          token: `old-token-${i}`,
          user_id: user.id,
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        })
        .execute();
    }

    // Should still be able to create a fresh token
    const token = await createRateLimitedMagicLinkToken(db, user.id);
    expect(token).not.toBeNull();
  });
});

describe("verifyMagicLinkToken()", () => {
  it("returns userId for a valid token", async () => {
    const user = await createVerifiedUser("test@example.com");
    const token = await createRateLimitedMagicLinkToken(db, user.id);
    expect(token).not.toBeNull();

    const userId = await verifyMagicLinkToken(db, token as string);
    expect(userId).toBe(user.id);
  });

  it("marks token as used (atomic)", async () => {
    const user = await createVerifiedUser("test@example.com");
    const token = await createRateLimitedMagicLinkToken(db, user.id);
    expect(token).not.toBeNull();

    await verifyMagicLinkToken(db, token as string);

    const row = await db
      .selectFrom("magic_link_tokens")
      .select("used_at")
      .where("token", "=", token as string)
      .executeTakeFirstOrThrow();

    expect(row.used_at).not.toBeNull();
  });

  it("returns null for already-used token (double-use prevented)", async () => {
    const user = await createVerifiedUser("test@example.com");
    const token = await createRateLimitedMagicLinkToken(db, user.id);
    expect(token).not.toBeNull();

    const first = await verifyMagicLinkToken(db, token as string);
    const second = await verifyMagicLinkToken(db, token as string);

    expect(first).toBe(user.id);
    expect(second).toBeNull();
  });

  it("returns null for expired token", async () => {
    const user = await createVerifiedUser("test@example.com");

    await db
      .insertInto("magic_link_tokens")
      .values({
        token: "expired-token",
        user_id: user.id,
        expires_at: new Date(Date.now() - 1000).toISOString(),
        created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      })
      .execute();

    const result = await verifyMagicLinkToken(db, "expired-token");
    expect(result).toBeNull();
  });

  it("returns null for non-existent token", async () => {
    const result = await verifyMagicLinkToken(db, "nonexistent-token");
    expect(result).toBeNull();
  });
});
