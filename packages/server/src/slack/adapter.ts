/**
 * Slack adapter — wires Slack event handlers (DM, thread, channel mention) onto a SlackBot.
 * Extracted from index.ts for testability. All handler logic lives here; index.ts only calls
 * createConfiguredSlackBot() and passes the result to the startup manager.
 */
import { join } from "node:path";
import { formatBufferedContext } from "../agent/prompt";
import type { AgentResult, McpServerConfig, RunAgentParams } from "../agent/runner";
import { getSessionId } from "../agent/sessions";
import { ensureChannelWorkspace, ensureWorkspace } from "../agent/workspace";
import type { Config } from "../config";
import type { createChannelRepository } from "../db/repositories/channels";
import type { createSettingsRepository } from "../db/repositories/settings";
import type { createUserRepository } from "../db/repositories/users";
import { type Attachment, downloadSlackFile } from "../files";
import type { Logger } from "../logger";
import type { QueueManager } from "../queue";
import { slackApiCall } from "./api";
import { SlackBot, type SlackFile } from "./bot";
import { createSlackMessageHandler } from "./message-handler";
import { resolveSlackUser } from "./resolve-user";
import type { BufferedMessage, ThreadBuffer } from "./thread-buffer";
import type { UserCache } from "./user-cache";

type UserRepository = ReturnType<typeof createUserRepository>;
type ChannelRepository = ReturnType<typeof createChannelRepository>;
type SettingsRepository = ReturnType<typeof createSettingsRepository>;

export interface SlackAdapterDeps {
  config: Config;
  logger: Logger;
  repos: {
    users: UserRepository;
    channels: ChannelRepository;
    settings: SettingsRepository;
  };
  queue: QueueManager;
  slack: {
    threadBuffer: ThreadBuffer;
    userCache: UserCache;
  };
  runAgent: (params: RunAgentParams) => Promise<AgentResult>;
  buildMcpServers: (email: string | null) => Promise<Record<string, McpServerConfig>>;
}

export async function validateSlackTokens(botToken: string, appToken: string) {
  void appToken;
  await slackApiCall(botToken, "auth.test");
}

async function downloadSlackFiles(
  files: SlackFile[],
  botToken: string | null | undefined,
  attachDir: string,
  maxBytes: number,
  logger: Logger,
): Promise<Attachment[]> {
  const attachments: Attachment[] = [];
  for (const file of files) {
    try {
      if (!botToken) {
        throw new Error("Slack bot token not configured");
      }
      const downloaded = await downloadSlackFile(file.urlPrivate, botToken, attachDir, maxBytes, logger);
      attachments.push(downloaded);
    } catch (err) {
      logger.warn({ err, fileName: file.name }, "Failed to download file");
    }
  }
  return attachments;
}

export function createConfiguredSlackBot(tokens: { botToken: string; appToken: string }, deps: SlackAdapterDeps) {
  const { config, logger, repos, queue, slack: slackDeps, runAgent, buildMcpServers } = deps;

  const slackBot = new SlackBot({
    appToken: tokens.appToken,
    botToken: tokens.botToken,
    logger,
  });

  const resolveUser = (slackUserId: string) =>
    resolveSlackUser(slackUserId, {
      users: repos.users,
      getUserInfo: (id) => slackDeps.userCache.resolve(id, (uid) => slackBot.getUserInfo(uid)),
      logger,
    });

  // DM handler
  slackBot.onMessage(async (message) => {
    const user = await resolveUser(message.userId);
    const userQueue = queue.getQueue(user.id);

    userQueue.enqueue(async () => {
      logger.info({ slackUserId: message.userId, channelId: message.channelId }, "Processing message");

      const workspaceDir = await ensureWorkspace(config, user.id);
      const settingsRow = await repos.settings.get();

      // Download any attached files
      let attachments: Attachment[] = [];
      if (message.files?.length) {
        logger.debug(
          {
            fileCount: message.files.length,
            files: message.files.map((f) => ({
              name: f.name,
              mime: f.mimetype,
              size: f.size,
              url: f.urlPrivate?.slice(0, 80),
            })),
          },
          "Files received from Slack",
        );
        const attachDir = join(workspaceDir, "attachments");
        const maxBytes = config.MAX_FILE_SIZE_MB * 1024 * 1024;
        attachments = await downloadSlackFiles(
          message.files,
          settingsRow?.slack_bot_token,
          attachDir,
          maxBytes,
          logger,
        );
        logger.debug(
          {
            attachmentCount: attachments.length,
            attachments: attachments.map((a) => ({ name: a.originalName, mime: a.mimeType, size: a.sizeBytes })),
          },
          "Files downloaded",
        );
      }

      // Post thinking indicator
      const thinkingTs = await slackBot.postMessage(message.channelId, "_Thinking..._");
      const onMessage = createSlackMessageHandler(slackBot, message.channelId, thinkingTs);

      const integrationMcpServers = await buildMcpServers(user.email);

      try {
        const result = await runAgent({
          userMessage: message.text || "See attached files.",
          workspaceDir,
          userName: user.name,
          userEmail: user.email,
          logger,
          platform: "slack",
          onMessage,
          orgName: settingsRow?.org_name,
          botName: settingsRow?.bot_name,
          attachments: attachments.length > 0 ? attachments : undefined,
          integrationMcpServers,
        });

        for (const filePath of result.pendingUploads) {
          try {
            await slackBot.uploadFile(message.channelId, filePath);
          } catch (err) {
            logger.warn({ err, filePath }, "Failed to upload file to Slack");
          }
        }

        if (!result.messageSent) {
          await slackBot.updateMessage(message.channelId, thinkingTs, "_No response_");
        }
      } catch (err) {
        logger.error({ err, userId: user.id }, "Agent run failed");
        await slackBot.updateMessage(message.channelId, thinkingTs, "_Something went wrong, try again_");
      }
    });
  });

  // Passive thread message handler
  slackBot.onThreadMessage(async (message) => {
    if (!message.threadTs) return;
    if (!slackDeps.threadBuffer.hasThread(message.channelId, message.threadTs)) return;

    const userInfo = await slackDeps.userCache.resolve(message.userId, (id) => slackBot.getUserInfo(id));

    let downloadedAttachments: Attachment[] = [];
    if (message.files?.length) {
      const workspaceDir = await ensureChannelWorkspace(config, message.channelId);
      const attachDir = join(workspaceDir, "attachments");
      const maxBytes = config.MAX_FILE_SIZE_MB * 1024 * 1024;
      const settingsRow = await repos.settings.get();
      downloadedAttachments = await downloadSlackFiles(
        message.files,
        settingsRow?.slack_bot_token,
        attachDir,
        maxBytes,
        logger,
      );
    }

    slackDeps.threadBuffer.append(message.channelId, message.threadTs, {
      userName: userInfo.realName,
      text: message.text,
      ts: message.ts,
      ...(downloadedAttachments.length > 0 && { attachments: downloadedAttachments }),
    });

    logger.debug(
      { channelId: message.channelId, threadTs: message.threadTs, user: userInfo.realName },
      "Buffered thread message",
    );
  });

  // Channel mention handler
  slackBot.onChannelMention(async (message) => {
    const threadTs = message.threadTs ?? message.ts;
    const mentionQueue = queue.getQueue(`${message.channelId}:${threadTs}`);

    mentionQueue.enqueue(async () => {
      logger.info({ slackUserId: message.userId, channelId: message.channelId }, "Processing channel mention");

      const user = await resolveUser(message.userId);

      let channel = await repos.channels.findBySlackChannelId(message.channelId);
      if (!channel) {
        const channelInfo = await slackBot.getChannelInfo(message.channelId);
        channel = await repos.channels.create({
          slackChannelId: message.channelId,
          name: channelInfo.name,
          type: channelInfo.type,
        });
        logger.info({ channelId: channel.id, name: channel.name }, "New channel created");
      }

      const workspaceDir = await ensureChannelWorkspace(config, message.channelId);
      const settingsRow = await repos.settings.get();

      slackDeps.threadBuffer.register(message.channelId, threadTs);

      // Download any attached files
      let attachments: Attachment[] = [];
      if (message.files?.length) {
        logger.debug(
          {
            fileCount: message.files.length,
            files: message.files.map((f) => ({
              name: f.name,
              mime: f.mimetype,
              size: f.size,
              url: f.urlPrivate?.slice(0, 80),
            })),
          },
          "Files received from Slack",
        );
        const attachDir = join(workspaceDir, "attachments");
        const maxBytes = config.MAX_FILE_SIZE_MB * 1024 * 1024;
        attachments = await downloadSlackFiles(
          message.files,
          settingsRow?.slack_bot_token,
          attachDir,
          maxBytes,
          logger,
        );
        logger.debug(
          {
            attachmentCount: attachments.length,
            attachments: attachments.map((a) => ({ name: a.originalName, mime: a.mimeType, size: a.sizeBytes })),
          },
          "Files downloaded",
        );
      }

      const existingSession = await getSessionId(workspaceDir, threadTs);
      let userMessage = message.text || "See attached files.";

      if (existingSession) {
        const buffered = slackDeps.threadBuffer.drain(message.channelId, threadTs);
        logger.debug({ threadTs, bufferedCount: buffered.length }, "Draining thread buffer for subsequent mention");
        userMessage = formatBufferedContext(buffered, user.name, userMessage);
      } else {
        const history = message.threadTs
          ? await slackBot.getThreadReplies(message.channelId, message.threadTs, config.SLACK_THREAD_HISTORY_LIMIT)
          : await slackBot.getChannelHistory(message.channelId, config.SLACK_CHANNEL_HISTORY_LIMIT);

        const filtered = history.filter((m) => m.ts !== message.ts);

        logger.debug(
          { source: message.threadTs ? "thread" : "channel", messageCount: filtered.length },
          "Bootstrap history fetched",
        );

        const bootstrapMessages: BufferedMessage[] = [];
        for (const msg of filtered.reverse()) {
          const info = await slackDeps.userCache.resolve(msg.userId, (id) => slackBot.getUserInfo(id));
          bootstrapMessages.push({ userName: info.realName, text: msg.text, ts: msg.ts });
        }
        const header = message.threadTs
          ? "[Thread context before you joined]"
          : "[Recent channel messages for context]";
        userMessage = formatBufferedContext(bootstrapMessages, user.name, userMessage, header);
      }

      const thinkingTs = await slackBot.postThreadReply(message.channelId, threadTs, "_Thinking..._");
      const onMessage = createSlackMessageHandler(slackBot, message.channelId, thinkingTs, threadTs);

      try {
        const result = await runAgent({
          userMessage,
          workspaceDir,
          userName: user.name,
          userEmail: user.email,
          logger,
          platform: "slack",
          onMessage,
          threadTs,
          orgName: settingsRow?.org_name,
          botName: settingsRow?.bot_name,
          attachments: attachments.length > 0 ? attachments : undefined,
          channelContext: {
            channelName: channel.name,
          },
        });

        for (const filePath of result.pendingUploads) {
          try {
            await slackBot.uploadFile(message.channelId, filePath, threadTs);
          } catch (err) {
            logger.warn({ err, filePath }, "Failed to upload file to Slack");
          }
        }

        if (!result.messageSent) {
          await slackBot.updateMessage(message.channelId, thinkingTs, "_No response_");
        }
      } catch (err) {
        logger.error({ err, userId: user.id, channelId: message.channelId }, "Agent run failed");
        await slackBot.updateMessage(message.channelId, thinkingTs, "_Something went wrong, try again_");
      }
    });
  });

  return slackBot;
}
