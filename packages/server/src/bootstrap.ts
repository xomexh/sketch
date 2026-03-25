/**
 * Server bootstrap — wires config, DB, repos, platform adapters, and HTTP into a
 * running server. Extracted from index.ts so the full stack can be instantiated
 * from tests with a custom Config and { connect: false }.
 */
import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { SpanStatusCode, context, trace } from "@opentelemetry/api";
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
import { createApp } from "./http";
import { buildMcpConfig } from "./integrations/factory";
import { createLogger } from "./logger";
import { QueueManager } from "./queue";
import { TaskScheduler } from "./scheduler/service";
import { syncFeaturedSkills } from "./skills/sync";
import { createConfiguredSlackBot, validateSlackTokens } from "./slack/adapter";
import type { SlackBot } from "./slack/bot";
import { createSlackStartupManager } from "./slack/startup";
import { ThreadBuffer } from "./slack/thread-buffer";
import { UserCache } from "./slack/user-cache";
import { initTelemetry } from "./telemetry/setup";
import { wireWhatsAppHandlers } from "./whatsapp/adapter";
import { WhatsAppBot } from "./whatsapp/bot";
import { GroupBuffer } from "./whatsapp/group-buffer";

export interface ServerHandle {
  config: Config;
  server: ReturnType<typeof serve>;
  db: ReturnType<typeof createDatabase>;
  whatsapp: WhatsAppBot;
  getSlack: () => SlackBot | null;
  shutdown: () => Promise<void>;
}

export interface CreateServerOptions {
  /** When false, skips whatsapp.start() and Slack startup. Defaults to true. */
  connect?: boolean;
}

export async function createServer(config: Config, options?: CreateServerOptions): Promise<ServerHandle> {
  const connect = options?.connect !== false;

  // 1. Logger
  const logger = createLogger(config);

  // 2. Database
  const db = createDatabase(config);
  await runMigrations(db);
  logger.info("Database ready");

  // 2.5. Sync featured skills
  await syncFeaturedSkills(logger);

  // 3. Repositories
  const users = createUserRepository(db);
  const channels = createChannelRepository(db);
  const settingsRepo = createSettingsRepository(db);
  const mcpServersRepo = createMcpServerRepository(db);
  const whatsappGroupsRepo = createWhatsAppGroupRepository(db);
  const outreachRepo = createOutreachRepository(db);
  const agentRunsRepo = createAgentRunsRepo(db);
  const telemetry = initTelemetry(agentRunsRepo, logger);
  const tracer = trace.getTracer("sketch");

  const trackedRunAgent = async (params: RunAgentParams): Promise<AgentResult> => {
    const runId = randomUUID();
    const span = tracer.startSpan("invoke_agent sketch");

    // Set params-derived attributes before try block (needed for error path — NOT NULL columns)
    span.setAttribute("gen_ai.operation.name", "invoke_agent");
    span.setAttribute("gen_ai.provider.name", "anthropic");
    span.setAttribute("sketch.run_id", runId);
    span.setAttribute("sketch.platform", params.platform);
    span.setAttribute("sketch.context_type", params.contextType ?? "dm");
    span.setAttribute("sketch.user_id", params.currentUserId ?? "");
    span.setAttribute("sketch.workspace_key", params.workspaceKey);
    span.setAttribute("sketch.thread_key", params.threadTs ?? "");

    try {
      const result = await runAgent(params);

      // Set result-derived attributes
      span.setAttribute("gen_ai.response.model", result.model ?? "");
      span.setAttribute("gen_ai.usage.input_tokens", result.inputTokens);
      span.setAttribute("gen_ai.usage.output_tokens", result.outputTokens);
      span.setAttribute("gen_ai.usage.cache_read_input_tokens", result.cacheReadTokens);
      span.setAttribute("gen_ai.usage.cache_creation_input_tokens", result.cacheCreationTokens);
      span.setAttribute("gen_ai.response.finish_reasons", [result.stopReason ?? "unknown"]);
      span.setAttribute("gen_ai.conversation.id", result.sessionId ?? "");
      span.setAttribute("sketch.cost_usd", result.costUsd);
      span.setAttribute("sketch.num_turns", result.numTurns);
      span.setAttribute("sketch.duration_api_ms", result.durationApiMs);
      span.setAttribute("sketch.error_subtype", result.errorSubtype ?? "");
      span.setAttribute("sketch.is_resumed_session", result.isResumedSession);
      span.setAttribute("sketch.message_sent", result.messageSent);
      span.setAttribute("sketch.web_search_requests", result.webSearchRequests);
      span.setAttribute("sketch.web_fetch_requests", result.webFetchRequests);
      span.setAttribute("sketch.total_attachments", result.totalAttachments);
      span.setAttribute("sketch.image_count", result.imageCount);
      span.setAttribute("sketch.non_image_count", result.nonImageCount);
      span.setAttribute("sketch.mime_types", JSON.stringify(result.mimeTypes));
      span.setAttribute("sketch.file_sizes", JSON.stringify(result.fileSizes));
      span.setAttribute("sketch.prompt_mode", result.promptMode);
      span.setAttribute("sketch.pending_uploads", result.pendingUploads.length);

      // Child spans for tool calls
      for (const tc of result.toolCalls) {
        const toolSpan = tracer.startSpan(`execute_tool ${tc.toolName}`, {}, trace.setSpan(context.active(), span));
        toolSpan.setAttribute("gen_ai.operation.name", "execute_tool");
        toolSpan.setAttribute("gen_ai.tool.name", tc.toolName);
        if (tc.skillName) toolSpan.setAttribute("sketch.skill.name", tc.skillName);
        toolSpan.end();
      }

      span.end();
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      throw err;
    }
  };

  // 4. LLM env from DB
  async function applyLlmEnvFromDb() {
    const settingsRow = await settingsRepo.get();
    applyLlmEnvFromSettings(settingsRow, logger);
  }
  await applyLlmEnvFromDb();

  // 5. Shared helpers
  async function buildMcpServers(userEmail: string | null): Promise<Record<string, McpServerConfig>> {
    const allServers = await mcpServersRepo.listAll();
    const servers: Record<string, McpServerConfig> = {};
    for (const s of allServers) {
      // Skip integration providers in skill mode (agent uses the skill's CLI instead)
      if (s.type != null && s.mode === "skill") continue;
      try {
        servers[s.slug] = buildMcpConfig(s.url, s.credentials, userEmail, s.type);
      } catch (err) {
        logger.warn({ err, serverId: s.id, serverSlug: s.slug }, "Failed to build MCP config for server");
      }
    }
    return servers;
  }

  // 6. Queue manager
  const queueManager = new QueueManager();

  // 7. Slack infrastructure
  const threadBuffer = new ThreadBuffer();
  const userCache = new UserCache();
  let slack: SlackBot | null = null;

  // 8. WhatsApp
  const whatsapp = new WhatsAppBot({ db, logger, groupMetadataStore: whatsappGroupsRepo });
  const groupBuffer = new GroupBuffer();

  // 8.5. Task scheduler — getSlack is a lazy getter so the live slack reference is captured correctly
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

  // 8.6. Connector sync scheduler — recovers stale syncs, runs periodic sync + enrichment
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

  // 9. HTTP server
  const app = createApp(db, config, {
    whatsapp,
    getSlack: () => slack,
    scheduler,
    onSlackTokensUpdated: async (tokens) => {
      if (!tokens) return;
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

  // 10. Start platforms
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

  // 11. Shutdown handle
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
