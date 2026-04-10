import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config";

/** Creates (if absent) and returns the per-user workspace directory path. */
export async function ensureWorkspace(config: Config, userId: string): Promise<string> {
  const workspaceDir = join(config.DATA_DIR, "workspaces", userId);
  await mkdir(workspaceDir, { recursive: true });
  return workspaceDir;
}

/** Creates (if absent) and returns the shared workspace directory for a Slack channel. */
export async function ensureChannelWorkspace(config: Config, slackChannelId: string): Promise<string> {
  const workspaceDir = join(config.DATA_DIR, "workspaces", `channel-${slackChannelId}`);
  await mkdir(workspaceDir, { recursive: true });
  return workspaceDir;
}

/**
 * Creates (if absent) and returns the shared workspace directory for a WhatsApp group.
 * Strips the `@g.us` suffix from the JID to derive a stable directory name.
 */
export async function ensureGroupWorkspace(config: Config, groupJid: string): Promise<string> {
  const groupId = groupJid.replace("@g.us", "");
  const workspaceDir = join(config.DATA_DIR, "workspaces", `wa-group-${groupId}`);
  await mkdir(workspaceDir, { recursive: true });
  return workspaceDir;
}
