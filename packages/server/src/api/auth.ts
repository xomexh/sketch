/**
 * Auth routes — admin login (password), member login (magic link), session management.
 * JWTs are signed with a per-deployment secret stored in the settings table,
 * so sessions survive server restarts. Cookie-based with httpOnly, sameSite=lax.
 */
import { randomBytes } from "node:crypto";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { verifyEmailToken } from "../auth/email-verify";
import { signJwt, verifyJwt } from "../auth/jwt";
import {
  type VerifiedUser,
  createRateLimitedMagicLinkToken,
  findVerifiedUserByEmail,
  verifyMagicLinkToken,
} from "../auth/magic-link";
import { verifyPassword } from "../auth/password";
import type { Config } from "../config";
import type { createSettingsRepository } from "../db/repositories/settings";
import type { createUserRepository } from "../db/repositories/users";
import type { DB } from "../db/schema";
import { resolveBaseUrl } from "./shared";

/** Delivers a magic link URL to the user via any configured channels. Returns the list of channels that succeeded. */
export type MagicLinkSender = (opts: {
  user: Pick<VerifiedUser, "email" | "slack_user_id" | "whatsapp_number">;
  magicLinkUrl: string;
  botName: string;
}) => Promise<string[]>;

export const SESSION_COOKIE = "sketch_session";
const PLATFORM_COOKIE = "sketch_platform_session";
/** Session cookie max-age in seconds (7 days). */
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

type SettingsRepo = ReturnType<typeof createSettingsRepository>;

/** Returns true when the request was made over HTTPS, used to set the Secure cookie flag. */
function isSecure(c: Context): boolean {
  return new URL(c.req.url).protocol === "https:";
}

/** Writes the session JWT as an httpOnly cookie with a 7-day max-age. */
function setSessionCookie(c: Context, token: string, secure: boolean) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** Signs a JWT for `sub` and sets the session cookie on the response. */
export async function createSession(
  c: Context,
  sub: string,
  role: "admin" | "member",
  jwtSecret: string,
): Promise<void> {
  const token = await signJwt(sub, role, jwtSecret);
  setSessionCookie(c, token, isSecure(c));
}

/** Registers all authentication routes: password login, logout, session check, email verification, and magic link. */
export function authRoutes(
  settings: SettingsRepo,
  db: Kysely<DB>,
  deps: {
    config: Config;
    logger: Logger;
    userRepo: ReturnType<typeof createUserRepository>;
    sendMagicLink: MagicLinkSender;
  },
) {
  const routes = new Hono();

  /**
   * Admin password login. Backfills `jwt_secret` for accounts created before the JWT migration
   * (older accounts have no secret stored; a new one is generated and persisted on first login).
   */
  routes.post("/login", async (c) => {
    const row = await settings.get();
    if (!row?.admin_email || !row?.admin_password_hash) {
      return c.json({ error: { code: "SETUP_REQUIRED", message: "Admin account not configured" } }, 503);
    }

    const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return c.json({ error: { code: "BAD_REQUEST", message: "Email and password required" } }, 400);
    }

    const emailMatch = body.email.toLowerCase() === row.admin_email.toLowerCase();
    const passwordMatch = emailMatch && (await verifyPassword(body.password, row.admin_password_hash));

    if (!emailMatch || !passwordMatch) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid credentials" } }, 401);
    }

    let jwtSecret = row.jwt_secret;
    if (!jwtSecret) {
      jwtSecret = randomBytes(32).toString("hex");
      await settings.update({ jwtSecret });
    }

    const adminUser = await deps.userRepo.findByEmail(row.admin_email.toLowerCase());
    const sub = adminUser?.id ?? row.admin_email;
    await createSession(c, sub, "member", jwtSecret);
    return c.json({ authenticated: true, email: row.admin_email });
  });

  routes.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ authenticated: false });
  });

  /**
   * Two-phase session check: local sketch_session first, then managed
   * sketch_platform_session (when MANAGED_AUTH_SECRET is configured).
   * Falls through from local to managed so an expired local cookie
   * doesn't block a valid platform session.
   */
  routes.get("/session", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const row = await settings.get();
      if (row?.jwt_secret) {
        const payload = await verifyJwt(token, row.jwt_secret);
        if (payload) {
          let user = await db.selectFrom("users").selectAll().where("id", "=", payload.sub).executeTakeFirst();

          if (!user && payload.sub.includes("@")) {
            user = await db.selectFrom("users").selectAll().where("email", "=", payload.sub).executeTakeFirst();
          }

          if (user) {
            await createSession(c, user.id, "member", row.jwt_secret);
            return c.json({
              authenticated: true,
              role: "member" as const,
              userId: user.id,
              name: user.name,
              email: user.email,
            });
          }
        }
      }
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
    }

    if (deps.config.MANAGED_AUTH_SECRET) {
      const platformToken = getCookie(c, PLATFORM_COOKIE);
      if (platformToken) {
        const payload = await verifyJwt(platformToken, deps.config.MANAGED_AUTH_SECRET);
        if (payload?.email) {
          const user = await db.selectFrom("users").selectAll().where("email", "=", payload.email).executeTakeFirst();
          if (user) {
            return c.json({
              authenticated: true,
              role: payload.role,
              userId: user.id,
              name: user.name,
              email: user.email,
            });
          }
        }
      }
    }

    return c.json({ authenticated: false });
  });

  /** Validates an email verification token and redirects with a success or error query param. */
  routes.get("/verify-email", async (c) => {
    const token = c.req.query("token");
    if (!token) {
      return c.redirect("/?verification=invalid");
    }

    const result = await verifyEmailToken(db, token);
    if (!result) {
      return c.redirect("/?verification=invalid");
    }

    return c.redirect("/?verification=success");
  });

  /**
   * Requests a magic link for the given email. Always returns `{ success: true }` regardless
   * of whether the email exists, to avoid user enumeration.
   */
  routes.post("/magic-link", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    if (!body.email) {
      return c.json({ error: { code: "BAD_REQUEST", message: "Email required" } }, 400);
    }

    const email = body.email.toLowerCase().trim();

    const noChannelsResponse = { success: true, channels: [] as string[] };

    const user = await findVerifiedUserByEmail(db, email);
    if (!user) return c.json(noChannelsResponse);

    const token = await createRateLimitedMagicLinkToken(db, user.id);
    if (!token) return c.json(noChannelsResponse);

    const baseUrl = resolveBaseUrl(c, deps.config);
    const magicLinkUrl = `${baseUrl}/api/auth/magic-link/verify?token=${token}`;

    const settingsRow = await settings.get();
    const botName = settingsRow?.bot_name ?? "Sketch";

    const channels = await deps.sendMagicLink({ user, magicLinkUrl, botName });

    if (channels.length === 0) {
      deps.logger.info({ magicLinkUrl }, "Magic link (no delivery channels configured)");
    }

    return c.json({ success: true, channels });
  });

  /** Validates a magic link token, creates a session, and redirects to the app root. */
  routes.get("/magic-link/verify", async (c) => {
    const token = c.req.query("token");
    if (!token) {
      return c.redirect("/login?error=invalid_link");
    }

    const userId = await verifyMagicLinkToken(db, token);
    if (!userId) {
      return c.redirect("/login?error=expired_link");
    }

    const settingsRow = await settings.get();
    if (!settingsRow?.jwt_secret) {
      return c.redirect("/login?error=server_error");
    }

    await createSession(c, userId, "member", settingsRow.jwt_secret);
    return c.redirect("/");
  });

  return routes;
}
