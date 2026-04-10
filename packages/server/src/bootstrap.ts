/**
 * Server bootstrap — wires config, DB, repositories, platform adapters, and HTTP into a
 * running server. Pass `{ connect: false }` to skip platform connections for test harnesses.
 */
import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { Kysely } from "kysely";
import { applyLlmEnvFromSettings } from "./agent/llm-env";
import { type AgentResult, runAgent } from "./agent/runner";
import type { McpServerConfig, RunAgentParams } from "./agent/runner";
import type { Config } from "./config";
import { createLlmCallFn } from "./connectors/llm";
import { startSyncScheduler } from "./connectors/sync";
import { createDatabase } from "./db/index";
import { runMigrations } from "./db/migrate";
import { createAgentRunsRepo } from "./db/repositories/agent-runs";
import { createChannelRepository } from "./db/repositories/channels";
import { createMcpServerRepository } from "./db/repositories/mcp-servers";
import { createOutreachRepository } from "./db/repositories/outreach";
import { createSettingsRepository } from "./db/repositories/settings";
import { createUserRepository } from "./db/repositories/users";
import { createWhatsAppGroupRepository } from "./db/repositories/whatsapp-groups";
import type { DB } from "./db/schema";
import { createApp } from "./http";
import { buildMcpConfig } from "./integrations/factory";
import { createLogger } from "./logger";
import { runManagedSeed } from "./managed-seed";
import { QueueManager } from "./queue";
import { TaskScheduler } from "./scheduler/service";
import { syncFeaturedSkills } from "./skills/sync";
import { createConfiguredSlackBot, validateSlackTokens } from "./slack/adapter";
import type { SlackBot } from "./slack/bot";
import { createSlackStartupManager } from "./slack/startup";
import { ThreadBuffer } from "./slack/thread-buffer";
import { UserCache } from "./slack/user-cache";
import { createToolCallSpans, setAgentResultAttributes, setAgentRunAttributes } from "./telemetry/instrument";
import { initTelemetry } from "./telemetry/setup";
import { wireWhatsAppHandlers } from "./whatsapp/adapter";
import { WhatsAppBot } from "./whatsapp/bot";
import { GroupBuffer } from "./whatsapp/group-buffer";

/** Live handle returned by {@link createServer}, used by tests and signal handlers. */
export interface ServerHandle {
  config: Config;
  /** The Hono/Node HTTP server instance. */
  server: ReturnType<typeof serve>;
  db: Kysely<DB>;
  whatsapp: WhatsAppBot;
  /** Returns the live SlackBot, or null if Slack is not configured or has disconnected. */
  getSlack: () => SlackBot | null;
  /** Gracefully stops all services in dependency order. */
  shutdown: () => Promise<void>;
}

export interface CreateServerOptions {
  /** When false, skips whatsapp.start() and Slack startup. Defaults to true. */
  connect?: boolean;
}

/**
 * Wires all server dependencies and returns a live {@link ServerHandle}.
 * @remarks
 * `getSlack` is threaded as a closure (`() => slack`) everywhere it is needed so that
 * the live `SlackBot` reference is always captured — `slack` is reassigned when tokens
 * are updated or the bot reconnects, so passing the value directly would capture a stale null.
 */
export async function createServer(config: Config, options?: CreateServerOptions): Promise<ServerHandle> {
  const connect = options?.connect !== false;

  const logger = createLogger(config);

  const db = await createDatabase(config);
  await runMigrations(db);
  logger.info("Database ready");

  await syncFeaturedSkills(config, logger);

  const users = createUserRepository(db);
  const channels = createChannelRepository(db);
  const settingsRepo = createSettingsRepository(db, config.ENCRYPTION_KEY);
  await runManagedSeed(config, settingsRepo);
  const mcpServersRepo = createMcpServerRepository(db);
  const whatsappGroupsRepo = createWhatsAppGroupRepository(db);
  const outreachRepo = createOutreachRepository(db);
  const agentRunsRepo = createAgentRunsRepo(db);
  const telemetry = initTelemetry(agentRunsRepo, logger, config);
  const tracer = trace.getTracer("sketch");

  /** Wraps {@link runAgent} with an OpenTelemetry span, recording run attributes and tool call child spans. */
  const trackedRunAgent = async (params: RunAgentParams): Promise<AgentResult> => {
    const runId = randomUUID();
    const span = tracer.startSpan("chat sketch");
    setAgentRunAttributes(span, params, runId);

    try {
      const result = await runAgent(params);
      setAgentResultAttributes(span, result);
      createToolCallSpans(tracer, span, runId, result.toolCalls);
      span.end();
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      throw err;
    }
  };

  /** Reads LLM provider settings from the DB and applies them as environment variables. */
  async function applyLlmEnvFromDb() {
    const settingsRow = await settingsRepo.get();
    applyLlmEnvFromSettings(settingsRow, logger);
  }
  await applyLlmEnvFromDb();

  /**
   * Builds the MCP server map for an agent run, keyed by slug.
   * Integration providers in skill mode are excluded — the agent invokes their CLI via the Skill tool instead.
   */
  async function buildMcpServers(userEmail: string | null): Promise<Record<string, McpServerConfig>> {
    const allServers = await mcpServersRepo.listAll();
    const servers: Record<string, McpServerConfig> = {};
    for (const s of allServers) {
      if (s.type != null && s.mode === "skill") continue;
      try {
        servers[s.slug] = buildMcpConfig(s.url, s.credentials, userEmail, s.type);
      } catch (err) {
        logger.warn({ err, serverId: s.id, serverSlug: s.slug }, "Failed to build MCP config for server");
      }
    }
    return servers;
  }

  const queueManager = new QueueManager();

  const threadBuffer = new ThreadBuffer();
  const userCache = new UserCache();
  let slack: SlackBot | null = null;

  const whatsapp = new WhatsAppBot({ db, logger, groupMetadataStore: whatsappGroupsRepo });
  const groupBuffer = new GroupBuffer();

  const scheduler = new TaskScheduler({
    db,
    config,
    logger,
    queueManager,
    getSlack: () => slack,
    whatsapp,
    settingsRepo,
    runAgent: trackedRunAgent,
    buildMcpServers,
    findIntegrationProvider: async () => {
      const row = await mcpServersRepo.findIntegrationProvider();
      if (!row || row.type == null) return null;
      return { type: row.type, credentials: row.credentials };
    },
  });
  await scheduler.start();

  const syncScheduler = startSyncScheduler(db, logger, 30 * 60 * 1000, {
    llmCall: createLlmCallFn(),
  });

  const slackAdapterDeps = {
    db,
    config,
    logger,
    repos: { users, channels, settings: settingsRepo },
    queue: queueManager,
    slack: { threadBuffer, userCache },
    runAgent: trackedRunAgent,
    buildMcpServers,
    findIntegrationProvider: async () => {
      const row = await mcpServersRepo.findIntegrationProvider();
      if (!row || row.type == null) return null;
      return { type: row.type, credentials: row.credentials };
    },
    scheduler,
    outreachRepo,
  };

  const startSlackBotIfConfigured = createSlackStartupManager({
    logger,
    slackMode: config.SLACK_MODE,
    getSettingsTokens: async () => {
      const settingsRow = await settingsRepo.get();
      return {
        botToken: settingsRow?.slack_bot_token,
        appToken: settingsRow?.slack_app_token,
      };
    },
    validateTokens: validateSlackTokens,
    getCurrentBot: () => slack,
    setCurrentBot: (bot) => {
      slack = bot;
    },
    createBot: (tokens) => createConfiguredSlackBot(tokens, slackAdapterDeps),
  });

  if (connect) {
    await startSlackBotIfConfigured().catch(() => {});
  }

  wireWhatsAppHandlers(whatsapp, {
    db,
    config,
    logger,
    repos: { users, settings: settingsRepo },
    queue: queueManager,
    groupBuffer,
    runAgent: trackedRunAgent,
    buildMcpServers,
    findIntegrationProvider: async () => {
      const row = await mcpServersRepo.findIntegrationProvider();
      if (!row || row.type == null) return null;
      return { type: row.type, credentials: row.credentials };
    },
    scheduler,
    outreachRepo,
  });

  const app = createApp(db, config, {
    whatsapp,
    getSlack: () => slack,
    scheduler,
    onSlackTokensUpdated: async (tokens) => {
      await startSlackBotIfConfigured(tokens);
    },
    onSlackDisconnect: async () => {
      if (slack) {
        await slack.stop();
        slack = null;
      }
      await settingsRepo.update({ slackBotToken: null, slackAppToken: null });
      logger.info("Slack disconnected and tokens cleared");
    },
    onLlmSettingsUpdated: async () => {
      await applyLlmEnvFromDb();
    },
    onSmtpUpdated: async () => {
      logger.info("SMTP configuration updated");
    },
    logger,
  });
  const server = serve({ fetch: app.fetch, port: config.PORT });
  logger.info({ port: config.PORT }, "HTTP server started");

  if (connect) {
    const whatsappConnected = await whatsapp.start();
    if (whatsappConnected) {
      logger.info("WhatsApp connected");
    } else {
      logger.info("WhatsApp not paired — use GET /api/channels/whatsapp/pair to connect");
    }

    if (!slack && !whatsappConnected) {
      logger.info("No channels active — pair WhatsApp via GET /api/channels/whatsapp/pair or configure Slack tokens");
    }
  }

  /** Gracefully stops all services: telemetry flush, schedulers, platform bots, HTTP server, DB. */
  async function shutdown() {
    logger.info("Shutting down...");
    await telemetry.shutdown();
    await syncScheduler.stop();
    scheduler.stop();
    if (slack) await slack.stop();
    await whatsapp.stop();
    server.close();
    await db.destroy();
  }

  return {
    config,
    server,
    db,
    whatsapp,
    getSlack: () => slack,
    shutdown,
  };
}
