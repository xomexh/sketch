import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../auth/password";
import { createSettingsRepository } from "../db/repositories/settings";
import type { DB } from "../db/schema";
import { createApp } from "../http";
import { createTestConfig, createTestDb, createTestLogger } from "../test-utils";

const config = createTestConfig();
const logger = createTestLogger();

async function seedAdmin(db: Kysely<DB>, email = "admin@test.com", password = "testpassword123") {
  const settings = createSettingsRepository(db);
  const hash = await hashPassword(password);
  await settings.create({ adminEmail: email, adminPasswordHash: hash });
  await settings.update({ onboardingCompletedAt: new Date().toISOString() });
}

async function loginAdmin(app: ReturnType<typeof createApp>) {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@test.com", password: "testpassword123" }),
  });
  return res.headers.get("set-cookie") ?? "";
}

describe("Settings API — security", () => {
  let db: Kysely<DB>;

  beforeEach(async () => {
    db = await createTestDb();
    await seedAdmin(db);
  });

  afterEach(async () => {
    try {
      await db.destroy();
    } catch {}
  });

  describe("GET /api/settings/search — API key masking", () => {
    it("does not expose the raw gemini_api_key when one is set", async () => {
      const settings = createSettingsRepository(db);
      await settings.update({ geminiApiKey: "AIza-super-secret-key-12345" });

      const app = createApp(db, config, { logger });
      const adminCookie = await loginAdmin(app);

      const res = await app.request("/api/settings/search", {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.geminiApiKey).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("AIza-super-secret-key-12345");
      expect(typeof body.geminiApiKeyConfigured).toBe("boolean");
      expect(body.geminiApiKeyConfigured).toBe(true);
    });

    it("returns geminiApiKeyConfigured: false when no key is set", async () => {
      const app = createApp(db, config, { logger });
      const adminCookie = await loginAdmin(app);

      const res = await app.request("/api/settings/search", {
        headers: { Cookie: adminCookie },
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.geminiApiKey).toBeUndefined();
      expect(body.geminiApiKeyConfigured).toBe(false);
    });
  });
});
