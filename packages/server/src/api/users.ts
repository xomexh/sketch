/**
 * Users API — CRUD for managing team members.
 * Primary use case: admin adds WhatsApp users so they can message the bot.
 * Slack users are auto-created on first DM and appear here as read-only.
 */
import { emailSchema, whatsappNumberSchema } from "@sketch/shared";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { z } from "zod";
import { countRecentTokens, createVerificationToken } from "../auth/email-verify.js";
import type { createSettingsRepository } from "../db/repositories/settings";
import type { createUserRepository } from "../db/repositories/users";
import type { DB } from "../db/schema.js";
import { type SmtpConfig, createEmailTransport, sendVerificationEmail } from "../email.js";

type UserRepo = ReturnType<typeof createUserRepository>;
type SettingsRepo = ReturnType<typeof createSettingsRepository>;

interface UserRoutesDeps {
  settings: SettingsRepo;
  db: Kysely<DB>;
  logger: Logger;
}

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  whatsappNumber: whatsappNumberSchema,
});

const updateUserSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  email: emailSchema.nullable().optional(),
  whatsappNumber: whatsappNumberSchema.nullable().optional(),
});

function getSmtpConfig(settings: {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_password: string | null;
  smtp_from: string | null;
}): SmtpConfig | null {
  if (
    !settings.smtp_host ||
    !settings.smtp_port ||
    !settings.smtp_user ||
    !settings.smtp_password ||
    !settings.smtp_from
  )
    return null;
  return {
    host: settings.smtp_host,
    port: settings.smtp_port,
    user: settings.smtp_user,
    password: settings.smtp_password,
    from: settings.smtp_from,
  };
}

async function sendOrLogVerification(
  deps: UserRoutesDeps,
  userId: string,
  email: string,
  baseUrl: string,
): Promise<{ sent: boolean }> {
  const token = await createVerificationToken(deps.db, userId, email);
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;

  const settingsRow = await deps.settings.get();
  if (!settingsRow) return { sent: false };

  const smtp = getSmtpConfig(settingsRow);
  if (smtp) {
    const transport = createEmailTransport(smtp);
    await sendVerificationEmail(transport, email, verifyUrl, settingsRow.bot_name ?? "Sketch", smtp.from);
    return { sent: true };
  }

  deps.logger.info({ email, verifyUrl }, "SMTP not configured — verification URL logged for dev");
  return { sent: false };
}

export function userRoutes(users: UserRepo, deps: UserRoutesDeps) {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const list = await users.list();
    return c.json({ users: list });
  });

  routes.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request";
      return c.json({ error: { code: "VALIDATION_ERROR", message } }, 400);
    }

    try {
      const user = await users.create({
        name: parsed.data.name,
        whatsappNumber: parsed.data.whatsappNumber,
      });
      return c.json({ user }, 201);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
        return c.json({ error: { code: "CONFLICT", message: "This number is already linked to another member" } }, 409);
      }
      throw err;
    }
  });

  routes.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await users.findById(id);
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "User not found" } }, 404);
    }

    const body = await c.req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request";
      return c.json({ error: { code: "VALIDATION_ERROR", message } }, 400);
    }

    try {
      const emailChanged = parsed.data.email !== undefined && parsed.data.email !== (existing.email ?? null);

      const user = await users.update(id, {
        name: parsed.data.name,
        email: parsed.data.email,
        whatsappNumber: parsed.data.whatsappNumber,
      });

      // Send verification email when email changes to a non-null value
      let verificationSent = false;
      if (emailChanged && user.email) {
        const protocol = c.req.header("x-forwarded-proto") || "http";
        const host = c.req.header("host") || "localhost:3000";
        const baseUrl = `${protocol}://${host}`;
        const result = await sendOrLogVerification(deps, id, user.email, baseUrl);
        verificationSent = result.sent;
      }

      return c.json({ user, verificationSent });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
        return c.json({ error: { code: "CONFLICT", message: "This number is already linked to another member" } }, 409);
      }
      throw err;
    }
  });

  // Resend verification email
  routes.post("/:id/verification", async (c) => {
    const id = c.req.param("id");
    const user = await users.findById(id);
    if (!user) {
      return c.json({ error: { code: "NOT_FOUND", message: "User not found" } }, 404);
    }
    if (!user.email) {
      return c.json({ error: { code: "NO_EMAIL", message: "User has no email address" } }, 400);
    }
    if (user.email_verified_at) {
      return c.json({ error: { code: "ALREADY_VERIFIED", message: "Email is already verified" } }, 400);
    }

    // Rate limit: max 5 per hour
    const recentCount = await countRecentTokens(deps.db, id);
    if (recentCount >= 5) {
      return c.json(
        { error: { code: "RATE_LIMITED", message: "Too many verification emails. Try again later." } },
        429,
      );
    }

    const protocol = c.req.header("x-forwarded-proto") || "http";
    const host = c.req.header("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;
    const result = await sendOrLogVerification(deps, id, user.email, baseUrl);

    return c.json({ success: true, sent: result.sent });
  });

  routes.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await users.findById(id);
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "User not found" } }, 404);
    }
    await users.remove(id);
    return c.json({ success: true });
  });

  return routes;
}
