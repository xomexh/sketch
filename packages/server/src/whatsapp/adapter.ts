/**
 * WhatsApp adapter — wires WhatsApp event handlers (DM, group) onto a WhatsAppBot.
 * Extracted from index.ts for testability.
 */
import { basename, join } from "node:path";
import type { WAMessage } from "@whiskeysockets/baileys";
import { formatBufferedContext } from "../agent/prompt";
import type { BufferedMessage } from "../agent/prompt";
import type { AgentResult, McpServerConfig, RunAgentParams } from "../agent/runner";
import { ensureGroupWorkspace, ensureWorkspace } from "../agent/workspace";
import type { Config } from "../config";
import type { createSettingsRepository } from "../db/repositories/settings";
import type { createUserRepository } from "../db/repositories/users";
import { type Attachment, downloadWhatsAppMedia, extensionToMime } from "../files";
import type { Logger } from "../logger";
import type { QueueManager } from "../queue";
import type { WhatsAppBot } from "./bot";
import { jidToPhoneNumber } from "./bot";
import type { GroupBuffer } from "./group-buffer";
import { createWhatsAppMessageHandler } from "./message-handler";

type UserRepository = ReturnType<typeof createUserRepository>;
type SettingsRepository = ReturnType<typeof createSettingsRepository>;

export interface WhatsAppAdapterDeps {
  config: Config;
  logger: Logger;
  repos: {
    users: UserRepository;
    settings: SettingsRepository;
  };
  queue: QueueManager;
  groupBuffer: GroupBuffer;
  runAgent: (params: RunAgentParams) => Promise<AgentResult>;
  buildMcpServers: (email: string | null) => Promise<Record<string, McpServerConfig>>;
  findIntegrationProvider: () => Promise<{ type: string; credentials: string } | null>;
}

export function wireWhatsAppHandlers(whatsapp: WhatsAppBot, deps: WhatsAppAdapterDeps): void {
  const { config, logger, repos, queue, groupBuffer, runAgent, buildMcpServers, findIntegrationProvider } = deps;
  const maxFileBytes = config.MAX_FILE_SIZE_MB * 1024 * 1024;

  whatsapp.onMessage(async (message) => {
    if (message.type === "dm") {
      // --- DM handler ---
      const user = await repos.users.findByWhatsappNumber(message.phoneNumber);
      if (!user) {
        await whatsapp.sendText(
          message.jid,
          "Sorry, you're not authorized to use this bot. Contact your admin to get access.",
        );
        return;
      }

      const userQueue = queue.getQueue(user.id);

      userQueue.enqueue(async () => {
        const workspaceDir = await ensureWorkspace(config, user.id);
        const settingsRow = await repos.settings.get();

        whatsapp.startComposing(message.jid);

        try {
          const attachments: Attachment[] = [];
          if (message.mediaType && whatsapp.socket) {
            const attachDir = join(workspaceDir, "attachments");
            try {
              const attachment = await downloadWhatsAppMedia(
                message.rawMessage,
                whatsapp.socket,
                attachDir,
                maxFileBytes,
                logger,
              );
              attachments.push(attachment);
            } catch (err) {
              logger.warn({ err, mediaType: message.mediaType }, "Failed to download WhatsApp media");
            }
          }

          const onMessage = createWhatsAppMessageHandler(whatsapp, message.jid);

          const waIntegrationMcpServers = await buildMcpServers(user.email);

          const result = await runAgent({
            userMessage: message.text || "See attached files.",
            workspaceDir,
            userName: user.name,
            userEmail: user.email,
            logger,
            platform: "whatsapp",
            onMessage,
            orgName: settingsRow?.org_name,
            botName: settingsRow?.bot_name,
            attachments: attachments.length > 0 ? attachments : undefined,
            integrationMcpServers: waIntegrationMcpServers,
            findIntegrationProvider,
          });

          for (const filePath of result.pendingUploads) {
            try {
              if (whatsapp.isConnected) {
                const ext = filePath.split(".").pop() ?? "";
                const mime = extensionToMime(ext);
                await whatsapp.sendFile(message.jid, filePath, mime, basename(filePath));
              }
            } catch (err) {
              logger.warn({ err, filePath }, "Failed to send file via WhatsApp");
            }
          }
        } catch (err) {
          logger.error({ err, userId: user.id }, "Agent run failed (WhatsApp)");
          if (whatsapp.isConnected) {
            await whatsapp.sendText(message.jid, "Something went wrong, try again.");
          }
        } finally {
          whatsapp.stopComposing(message.jid);
        }
      });
      return;
    }

    // --- Group handler ---

    if (!message.isMentioned) {
      const senderPhone = jidToPhoneNumber(message.senderJid);
      const user = await repos.users.findByWhatsappNumber(senderPhone);
      groupBuffer.append(message.jid, {
        senderName: user?.name ?? message.pushName,
        text: message.text,
        timestamp: Date.now(),
      });
      return;
    }

    const senderPhone = jidToPhoneNumber(message.senderJid);
    const user = await repos.users.findByWhatsappNumber(senderPhone);
    const userName = user?.name ?? message.pushName;

    const groupJid = message.jid;
    const groupQueue = queue.getQueue(`wa-group-${groupJid}`);

    groupQueue.enqueue(async () => {
      const workspaceDir = await ensureGroupWorkspace(config, groupJid);
      const settingsRow = await repos.settings.get();
      const groupMeta = await whatsapp.getGroupMetadata(groupJid);
      const groupName = groupMeta?.subject ?? "Unknown Group";
      const groupDescription = groupMeta?.desc ?? undefined;

      whatsapp.startComposing(groupJid);

      try {
        const buffered = groupBuffer.drain(groupJid);
        const contextMessages: BufferedMessage[] = buffered.map((m) => ({
          userName: m.senderName,
          text: m.text,
          ts: String(m.timestamp),
        }));

        const attachments: Attachment[] = [];
        if (message.mediaType && whatsapp.socket) {
          const attachDir = join(workspaceDir, "attachments");
          try {
            const attachment = await downloadWhatsAppMedia(
              message.rawMessage,
              whatsapp.socket,
              attachDir,
              maxFileBytes,
              logger,
            );
            attachments.push(attachment);
          } catch (err) {
            logger.warn({ err, mediaType: message.mediaType }, "Failed to download WhatsApp media");
          }
        }

        const userMessage = formatBufferedContext(contextMessages, userName, message.text || "See attached files.");

        const onMessage = createWhatsAppMessageHandler(whatsapp, groupJid, message.rawMessage as WAMessage);

        const result = await runAgent({
          userMessage,
          workspaceDir,
          userName,
          logger,
          platform: "whatsapp",
          onMessage,
          orgName: settingsRow?.org_name,
          botName: settingsRow?.bot_name,
          attachments: attachments.length > 0 ? attachments : undefined,
          groupContext: { groupName, groupDescription },
          findIntegrationProvider,
        });

        for (const filePath of result.pendingUploads) {
          try {
            if (whatsapp.isConnected) {
              const ext = filePath.split(".").pop() ?? "";
              const mime = extensionToMime(ext);
              await whatsapp.sendFile(groupJid, filePath, mime, basename(filePath));
            }
          } catch (err) {
            logger.warn({ err, filePath }, "Failed to send file via WhatsApp");
          }
        }
      } catch (err) {
        logger.error({ err, groupJid }, "Agent run failed (WhatsApp group)");
        if (whatsapp.isConnected) {
          await whatsapp.sendText(groupJid, "Something went wrong, try again.");
        }
      } finally {
        whatsapp.stopComposing(groupJid);
      }
    });
  });
}
