/**
 * API middleware — setup mode detection and auth enforcement.
 *
 * Setup mode:
 * - Before an admin account exists, only setup status/account + public paths
 *   are accessible. All other API routes return 503.
 * - After an admin exists but onboarding is incomplete, only /api/setup/*
 *   routes are accessible, and non-public setup routes require auth.
 *
 * Auth: when an admin account exists, all non-public API routes require
 * a valid JWT session cookie. Role and subject are set on the Hono context.
 */
import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { verifyJwt } from "../auth/jwt";
import type { createSettingsRepository } from "../db/repositories/settings";
import { SESSION_COOKIE } from "./auth";

declare module "hono" {
  interface ContextVariableMap {
    role: "admin" | "member";
    sub: string;
  }
}

/** Routes that skip auth entirely (login, magic-link verify, health, OAuth callback). */
const PUBLIC_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/session",
  "/api/auth/verify-email",
  "/api/auth/magic-link",
  "/api/auth/magic-link/verify",
  "/api/health",
  "/api/oauth/google/callback",
]);
const SETUP_PATHS_PREFIX = "/api/setup";
/** Setup bootstrap paths that must be accessible before any admin account exists. */
const PUBLIC_SETUP_PATHS = new Set(["/api/setup/status", "/api/setup/account"]);
/** WhatsApp pairing paths accessible during onboarding step 3, before setup is complete. */
const ONBOARDING_PATHS_PREFIX = "/api/channels/whatsapp";
/** Cookie name set by the managed (platform) SSO layer. */
const PLATFORM_COOKIE = "sketch_platform_session";

type SettingsRepo = ReturnType<typeof createSettingsRepository>;

/** Optional options for managed (platform) SSO integration. */
export interface AuthMiddlewareOpts {
  managedAuthSecret?: string;
  managedUrl?: string;
  findUserByEmail?: (email: string) => Promise<{ id: string } | null>;
}

/**
 * Hono middleware that enforces authentication and setup-mode gating.
 *
 * Auth priority order:
 * 1. System routes (`/api/system/*`) — bypass this middleware entirely (they carry their own bearer token).
 * 2. Public setup bootstrap paths — always allowed, no auth required.
 * 3. Pre-admin state — only public paths pass; all others get 503 SETUP_REQUIRED.
 * 4. Post-admin, pre-onboarding — setup and WhatsApp pairing paths are allowed; others get 503.
 * 5. Managed SSO — if `managedAuthSecret` is configured, the platform cookie is checked first.
 * 6. Local JWT session cookie (`sketch_session`).
 * @remarks
 * If the settings DB is unavailable, public paths are allowed through and all others are blocked.
 * This is intentional: the DB being down is not a reason to open authenticated routes.
 */
export function createAuthMiddleware(settings: SettingsRepo, opts?: AuthMiddlewareOpts) {
  let cachedSecret: string | null = null;

  return async (c: Context, next: Next) => {
    const path = c.req.path;

    if (path.startsWith("/api/system/")) {
      return next();
    }

    const isSetupPath = path.startsWith(SETUP_PATHS_PREFIX);
    const isPublicPath = PUBLIC_PATHS.has(path);
    const isPublicSetupPath = PUBLIC_SETUP_PATHS.has(path);

    if (isPublicSetupPath) {
      return next();
    }

    let setupComplete = false;
    let hasAdmin = false;
    let jwtSecret: string | null = null;
    try {
      const row = await settings.get();
      setupComplete = Boolean(row?.onboarding_completed_at);
      hasAdmin = Boolean(row?.admin_email);
      jwtSecret = row?.jwt_secret ?? null;
      if (jwtSecret) cachedSecret = jwtSecret;
    } catch {}

    const isOnboardingPath = path.startsWith(ONBOARDING_PATHS_PREFIX);

    if (!setupComplete && !hasAdmin) {
      if (isPublicPath) {
        return next();
      }
      return c.json({ error: { code: "SETUP_REQUIRED", message: "Onboarding not complete" } }, 503);
    }

    if (!setupComplete && !isSetupPath && !isOnboardingPath) {
      if (isPublicPath) {
        return next();
      }
      return c.json({ error: { code: "SETUP_REQUIRED", message: "Onboarding not complete" } }, 503);
    }

    if (isPublicPath) {
      return next();
    }

    if (opts?.managedAuthSecret) {
      const platformToken = getCookie(c, PLATFORM_COOKIE);
      if (platformToken) {
        const payload = await verifyJwt(platformToken, opts.managedAuthSecret);
        if (!payload || !payload.email) {
          const loginUrl = opts.managedUrl ? `${opts.managedUrl}/login` : "/login";
          return c.redirect(loginUrl);
        }

        const user = await opts.findUserByEmail?.(payload.email);
        if (!user) {
          return c.json({ error: { code: "FORBIDDEN", message: "User not found in this tenant" } }, 403);
        }

        c.set("role", "member");
        c.set("sub", user.id);
        return next();
      }
    }

    const secret = jwtSecret ?? cachedSecret;
    if (!secret) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    }

    const token = getCookie(c, SESSION_COOKIE);
    if (!token) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
    }

    const payload = await verifyJwt(token, secret);
    if (!payload) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Session expired" } }, 401);
    }

    c.set("role", payload.role);
    c.set("sub", payload.sub);

    return next();
  };
}
