/**
 * HTTP app factory — API routes, auth middleware, static file serving.
 * Route registration order: API routes → static assets → SPA catch-all.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { Logger } from "pino";
import { authRoutes } from "./api/auth";
import { channelRoutes } from "./api/channels";
import { healthRoutes } from "./api/health";
import { mcpServerRoutes } from "./api/mcp-servers";
import { createAuthMiddleware } from "./api/middleware";
import { settingsRoutes } from "./api/settings";
import { setupRoutes } from "./api/setup";
import { skillsRoutes } from "./api/skills";
import { userRoutes } from "./api/users";
import { whatsappRoutes } from "./api/whatsapp";
import type { Config } from "./config";
import { createMcpServerRepository } from "./db/repositories/mcp-servers";
import { createSettingsRepository } from "./db/repositories/settings";
import { createUserRepository } from "./db/repositories/users";
import type { DB } from "./db/schema";
import type { SlackBot } from "./slack/bot";
import type { WhatsAppBot } from "./whatsapp/bot";

interface AppDeps {
  whatsapp?: WhatsAppBot;
  getSlack?: () => SlackBot | null;
  onSlackTokensUpdated?: (tokens?: { botToken: string; appToken: string }) => Promise<void>;
  onSlackDisconnect?: () => Promise<void>;
  onLlmSettingsUpdated?: () => Promise<void>;
  onSmtpUpdated?: () => Promise<void>;
  logger?: Logger;
}

export function createApp(db: Kysely<DB>, config: Config, deps?: AppDeps) {
  const app = new Hono();
  const settings = createSettingsRepository(db);
  const users = createUserRepository(db);
  const mcpServers = createMcpServerRepository(db);
  const logger = deps?.logger ?? (console as unknown as Logger);

  // Auth middleware on all /api/* routes (with setup mode + auth checks)
  app.use("/api/*", createAuthMiddleware(settings));

  // API routes
  app.route("/api/health", healthRoutes(db));
  app.route("/api/auth", authRoutes(settings, db, { config, logger }));
  app.route(
    "/api/setup",
    setupRoutes(settings, {
      onSlackTokensUpdated: deps?.onSlackTokensUpdated,
      onLlmSettingsUpdated: deps?.onLlmSettingsUpdated,
    }),
  );
  app.route("/api/settings", settingsRoutes(settings));
  app.route("/api/skills", skillsRoutes(config));
  app.route("/api/users", userRoutes(users, { settings, db, logger, config }));
  app.route("/api/mcp-servers", mcpServerRoutes(mcpServers, users));
  app.route(
    "/api/channels",
    channelRoutes({
      whatsapp: deps?.whatsapp,
      getSlack: deps?.getSlack,
      onSlackDisconnect: deps?.onSlackDisconnect,
      settings,
      onSmtpUpdated: deps?.onSmtpUpdated,
    }),
  );

  if (deps?.whatsapp) {
    app.route("/api/channels/whatsapp", whatsappRoutes(deps.whatsapp));
  }

  // Static file serving for the SPA (production only — dev uses Vite dev server)
  // In production, web assets are copied into dist/public/ alongside the server bundle.
  // In dev (tsx), fall back to the monorepo path.
  const bundledDir = resolve(import.meta.dirname, "public");
  const monorepoDir = resolve(import.meta.dirname, "../../web/dist");
  const webDistDir = existsSync(bundledDir) ? bundledDir : monorepoDir;

  if (existsSync(webDistDir)) {
    // Serve hashed assets (JS, CSS, images)
    app.use("/assets/*", serveStatic({ root: webDistDir }));

    // SPA catch-all: any non-API route returns index.html for client-side routing
    const indexHtml = readFileSync(join(webDistDir, "index.html"), "utf-8");
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api/")) {
        return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
      }
      return c.html(indexHtml);
    });
  }

  return app;
}
