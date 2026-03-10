import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUserRepository } from "../db/repositories/users";
import type { DB } from "../db/schema";
import { createTestDb } from "../test-utils";
import {
  countRecentMagicLinkTokens,
  createMagicLinkToken,
  findVerifiedUserByEmail,
  verifyMagicLinkToken,
} from "./magic-link";

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

describe("createMagicLinkToken()", () => {
  it("returns a 64-char hex token", async () => {
    const user = await createVerifiedUser("test@example.com");
    const token = await createMagicLinkToken(db, user.id);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores token in the database", async () => {
    const user = await createVerifiedUser("test@example.com");
    const token = await createMagicLinkToken(db, user.id);

    const row = await db.selectFrom("magic_link_tokens").selectAll().where("token", "=", token).executeTakeFirst();

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

    await createMagicLinkToken(db, user.id);

    const expired = await db
      .selectFrom("magic_link_tokens")
      .selectAll()
      .where("token", "=", "expired-token")
      .executeTakeFirst();

    expect(expired).toBeUndefined();
  });
});

describe("verifyMagicLinkToken()", () => {
  it("returns userId for a valid token", async () => {
    const user = await createVerifiedUser("test@example.com");
    const token = await createMagicLinkToken(db, user.id);

    const userId = await verifyMagicLinkToken(db, token);
    expect(userId).toBe(user.id);
  });

  it("marks token as used (atomic)", async () => {
    const user = await createVerifiedUser("test@example.com");
    const token = await createMagicLinkToken(db, user.id);

    await verifyMagicLinkToken(db, token);

    const row = await db
      .selectFrom("magic_link_tokens")
      .select("used_at")
      .where("token", "=", token)
      .executeTakeFirstOrThrow();

    expect(row.used_at).not.toBeNull();
  });

  it("returns null for already-used token (double-use prevented)", async () => {
    const user = await createVerifiedUser("test@example.com");
    const token = await createMagicLinkToken(db, user.id);

    const first = await verifyMagicLinkToken(db, token);
    const second = await verifyMagicLinkToken(db, token);

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

describe("countRecentMagicLinkTokens()", () => {
  it("returns 0 when no tokens exist", async () => {
    const user = await createVerifiedUser("test@example.com");
    const count = await countRecentMagicLinkTokens(db, user.id);
    expect(count).toBe(0);
  });

  it("counts tokens created within the last 15 minutes", async () => {
    const user = await createVerifiedUser("test@example.com");

    await createMagicLinkToken(db, user.id);
    await createMagicLinkToken(db, user.id);
    await createMagicLinkToken(db, user.id);

    const count = await countRecentMagicLinkTokens(db, user.id);
    expect(count).toBe(3);
  });

  it("does not count tokens older than 15 minutes", async () => {
    const user = await createVerifiedUser("test@example.com");

    await db
      .insertInto("magic_link_tokens")
      .values({
        token: "old-token",
        user_id: user.id,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      })
      .execute();

    const count = await countRecentMagicLinkTokens(db, user.id);
    expect(count).toBe(0);
  });

  it("does not count tokens from other users", async () => {
    const user1 = await createVerifiedUser("user1@example.com");
    const user2 = await createVerifiedUser("user2@example.com");

    await createMagicLinkToken(db, user1.id);
    await createMagicLinkToken(db, user2.id);

    const count = await countRecentMagicLinkTokens(db, user1.id);
    expect(count).toBe(1);
  });
});
