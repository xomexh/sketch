import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUserRepository } from "../db/repositories/users";
import type { DB } from "../db/schema";
import { createTestDb } from "../test-utils";
import { countRecentTokens, createVerificationToken, verifyEmailToken } from "./email-verify";

let db: Kysely<DB>;
let users: ReturnType<typeof createUserRepository>;

beforeEach(async () => {
  db = await createTestDb();
  users = createUserRepository(db);
});

afterEach(async () => {
  await db.destroy();
});

async function createUser(email: string) {
  const user = await users.create({ name: "Test User" });
  await users.update(user.id, { email });
  return user;
}

describe("createVerificationToken()", () => {
  it("returns a 64-char hex token", async () => {
    const user = await createUser("test@example.com");
    const token = await createVerificationToken(db, user.id, "test@example.com");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores token in the database", async () => {
    const user = await createUser("test@example.com");
    const token = await createVerificationToken(db, user.id, "test@example.com");

    const row = await db
      .selectFrom("email_verification_tokens")
      .selectAll()
      .where("token", "=", token)
      .executeTakeFirst();

    expect(row).toBeDefined();
    expect(row?.user_id).toBe(user.id);
    expect(row?.email).toBe("test@example.com");
    expect(row?.used_at).toBeNull();
  });

  it("sets expiry 24 hours in the future", async () => {
    const user = await createUser("test@example.com");
    const before = Date.now();
    const token = await createVerificationToken(db, user.id, "test@example.com");
    const after = Date.now();

    const row = await db
      .selectFrom("email_verification_tokens")
      .select("expires_at")
      .where("token", "=", token)
      .executeTakeFirstOrThrow();

    const expiresMs = new Date(row.expires_at).getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    expect(expiresMs).toBeGreaterThanOrEqual(before + twentyFourHours - 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + twentyFourHours + 1000);
  });

  it("generates unique tokens each time", async () => {
    const user = await createUser("test@example.com");
    const token1 = await createVerificationToken(db, user.id, "test@example.com");
    const token2 = await createVerificationToken(db, user.id, "test@example.com");
    expect(token1).not.toBe(token2);
  });

  it("cleans up expired tokens for the user", async () => {
    const user = await createUser("test@example.com");

    // Insert an expired token directly
    await db
      .insertInto("email_verification_tokens")
      .values({
        token: "expired-token",
        user_id: user.id,
        email: "test@example.com",
        expires_at: new Date(Date.now() - 1000).toISOString(),
      })
      .execute();

    // Creating a new token should clean up the expired one
    await createVerificationToken(db, user.id, "test@example.com");

    const expired = await db
      .selectFrom("email_verification_tokens")
      .selectAll()
      .where("token", "=", "expired-token")
      .executeTakeFirst();

    expect(expired).toBeUndefined();
  });

  it("invalidates previous unused tokens for the same user", async () => {
    const user = await createUser("test@example.com");
    const first = await createVerificationToken(db, user.id, "test@example.com");
    await createVerificationToken(db, user.id, "test@example.com");

    const firstRow = await db
      .selectFrom("email_verification_tokens")
      .selectAll()
      .where("token", "=", first)
      .executeTakeFirst();

    expect(firstRow).toBeDefined();
    expect(firstRow?.used_at).not.toBeNull();
  });

  it("does not invalidate tokens from other users", async () => {
    const user1 = await createUser("user1@example.com");
    const user2 = await users.create({ name: "Other User" });
    await users.update(user2.id, { email: "user2@example.com" });

    const user2Token = await createVerificationToken(db, user2.id, "user2@example.com");
    await createVerificationToken(db, user1.id, "user1@example.com");

    const row = await db
      .selectFrom("email_verification_tokens")
      .selectAll()
      .where("token", "=", user2Token)
      .executeTakeFirst();

    expect(row).toBeDefined();
    expect(row?.used_at).toBeNull();
  });
});

describe("verifyEmailToken()", () => {
  it("returns userId and email for a valid token", async () => {
    const user = await createUser("test@example.com");
    const token = await createVerificationToken(db, user.id, "test@example.com");

    const result = await verifyEmailToken(db, token);

    expect(result).toEqual({ userId: user.id, email: "test@example.com" });
  });

  it("marks the token as used", async () => {
    const user = await createUser("test@example.com");
    const token = await createVerificationToken(db, user.id, "test@example.com");

    await verifyEmailToken(db, token);

    const row = await db
      .selectFrom("email_verification_tokens")
      .select("used_at")
      .where("token", "=", token)
      .executeTakeFirstOrThrow();

    expect(row.used_at).not.toBeNull();
  });

  it("sets email_verified_at on the user", async () => {
    const user = await createUser("test@example.com");
    const token = await createVerificationToken(db, user.id, "test@example.com");

    await verifyEmailToken(db, token);

    const updated = await users.findById(user.id);
    expect(updated?.email_verified_at).not.toBeNull();
  });

  it("returns null for an already-used token", async () => {
    const user = await createUser("test@example.com");
    const token = await createVerificationToken(db, user.id, "test@example.com");

    await verifyEmailToken(db, token);
    const second = await verifyEmailToken(db, token);

    expect(second).toBeNull();
  });

  it("returns null for a non-existent token", async () => {
    const result = await verifyEmailToken(db, "nonexistent-token");
    expect(result).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const user = await createUser("test@example.com");

    // Insert an expired token directly
    await db
      .insertInto("email_verification_tokens")
      .values({
        token: "expired-token",
        user_id: user.id,
        email: "test@example.com",
        expires_at: new Date(Date.now() - 1000).toISOString(),
      })
      .execute();

    const result = await verifyEmailToken(db, "expired-token");
    expect(result).toBeNull();
  });

  it("returns null when user's email no longer matches the token", async () => {
    const user = await createUser("old@example.com");
    const token = await createVerificationToken(db, user.id, "old@example.com");

    // Change the user's email
    await users.update(user.id, { email: "new@example.com" });

    const result = await verifyEmailToken(db, token);
    expect(result).toBeNull();
  });

  it("returns null when user has been deleted", async () => {
    const user = await createUser("test@example.com");
    const token = await createVerificationToken(db, user.id, "test@example.com");

    await users.remove(user.id);

    const result = await verifyEmailToken(db, token);
    expect(result).toBeNull();
  });

  it("does not set email_verified_at when token is invalid", async () => {
    const user = await createUser("old@example.com");
    const token = await createVerificationToken(db, user.id, "old@example.com");

    await users.update(user.id, { email: "new@example.com" });
    await verifyEmailToken(db, token);

    const updated = await users.findById(user.id);
    expect(updated?.email_verified_at).toBeNull();
  });
});

describe("countRecentTokens()", () => {
  it("returns 0 when no tokens exist", async () => {
    const user = await createUser("test@example.com");
    const count = await countRecentTokens(db, user.id);
    expect(count).toBe(0);
  });

  it("counts tokens created within the last hour", async () => {
    const user = await createUser("test@example.com");

    await createVerificationToken(db, user.id, "test@example.com");
    await createVerificationToken(db, user.id, "test@example.com");
    await createVerificationToken(db, user.id, "test@example.com");

    const count = await countRecentTokens(db, user.id);
    expect(count).toBe(3);
  });

  it("does not count tokens older than one hour", async () => {
    const user = await createUser("test@example.com");

    // Insert an old token directly
    await db
      .insertInto("email_verification_tokens")
      .values({
        token: "old-token",
        user_id: user.id,
        email: "test@example.com",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      })
      .execute();

    const count = await countRecentTokens(db, user.id);
    expect(count).toBe(0);
  });

  it("does not count tokens from other users", async () => {
    const user1 = await createUser("user1@example.com");
    const user2 = await users.create({ name: "Other User" });
    await users.update(user2.id, { email: "user2@example.com" });

    await createVerificationToken(db, user1.id, "user1@example.com");
    await createVerificationToken(db, user2.id, "user2@example.com");

    const count = await countRecentTokens(db, user1.id);
    expect(count).toBe(1);
  });
});
