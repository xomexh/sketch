/**
 * Typed API client for the control plane backend.
 * All methods throw on non-2xx responses with the standard error shape.
 */

import type { SkillCategory } from "@/lib/skills-data";
import type { IntegrationApp, IntegrationConnection, McpServerRecord, PageInfo } from "@sketch/shared";

export interface ApiError {
  error: { code: string; message: string };
}

export interface User {
  id: string;
  name: string;
  email: string | null;
  email_verified_at: string | null;
  slack_user_id: string | null;
  whatsapp_number: string | null;
  created_at: string;
}

export interface ScheduledTaskListItem {
  id: string;
  platform: "slack" | "whatsapp";
  contextType: "dm" | "channel" | "group";
  deliveryTarget: string;
  threadTs: string | null;
  prompt: string;
  scheduleType: "cron" | "interval" | "once";
  scheduleValue: string;
  timezone: string;
  sessionMode: "fresh" | "persistent" | "chat";
  nextRunAt: string | null;
  lastRunAt: string | null;
  status: "active" | "paused" | "completed";
  createdBy: string | null;
  createdAt: string;
  targetLabel: string;
  targetKindLabel: "Slack DM" | "Slack channel" | "WhatsApp DM" | "WhatsApp group";
  creatorName: string | null;
  scheduleLabel: string;
  canPause: boolean;
  canResume: boolean;
  canDelete: boolean;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...((options?.headers as Record<string, string>) ?? {}) };
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: { code: "UNKNOWN", message: res.statusText } }))) as ApiError;
    throw new Error(body.error.message);
  }

  return res.json() as Promise<T>;
}

export interface ChannelStatus {
  platform: "slack" | "whatsapp" | "email";
  configured: boolean;
  connected: boolean | null;
  phoneNumber?: string | null;
  outboundOnly?: boolean;
}

export interface SetupStatus {
  completed: boolean;
  currentStep: number;
  adminEmail: string | null;
  orgName: string | null;
  botName: string;
  slackConnected: boolean;
  llmConnected: boolean;
  llmProvider: "anthropic" | "bedrock" | null;
}

export interface SessionResponse {
  authenticated: boolean;
  role?: "admin" | "member";
  email?: string;
  userId?: string;
  name?: string;
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  body: string;
}

export const api = {
  setup: {
    status() {
      return request<SetupStatus>("/api/setup/status");
    },
    verifySlack(botToken: string, appToken: string) {
      return request<{ success: boolean; workspaceName?: string }>("/api/setup/slack/verify", {
        method: "POST",
        body: JSON.stringify({ botToken, appToken }),
      });
    },
    verifyLlm(
      data:
        | { provider: "anthropic"; apiKey: string }
        | { provider: "bedrock"; awsAccessKeyId: string; awsSecretAccessKey: string; awsRegion: string },
    ) {
      return request<{ success: boolean }>("/api/setup/llm/verify", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    createAccount(email: string, password: string) {
      return request<{ success: boolean }>("/api/setup/account", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    },
    identity(orgName: string, botName: string) {
      return request<{ success: boolean }>("/api/setup/identity", {
        method: "POST",
        body: JSON.stringify({ orgName, botName }),
      });
    },
    slack(botToken: string, appToken: string) {
      return request<{ success: boolean }>("/api/setup/slack", {
        method: "POST",
        body: JSON.stringify({ botToken, appToken }),
      });
    },
    llm(
      data:
        | { provider: "anthropic"; apiKey: string }
        | { provider: "bedrock"; awsAccessKeyId: string; awsSecretAccessKey: string; awsRegion: string },
    ) {
      return request<{ success: boolean }>("/api/setup/llm", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    complete() {
      return request<{ success: boolean }>("/api/setup/complete", {
        method: "POST",
      });
    },
  },
  auth: {
    login(email: string, password: string) {
      return request<{ authenticated: boolean; email: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    },
    logout() {
      return request<{ authenticated: boolean }>("/api/auth/logout", { method: "POST" });
    },
    session() {
      return request<SessionResponse>("/api/auth/session");
    },
    magicLink: {
      request(email: string) {
        return request<{ success: boolean }>("/api/auth/magic-link", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
      },
    },
  },
  channels: {
    status() {
      return request<{ channels: ChannelStatus[] }>("/api/channels/status");
    },
    disconnectSlack() {
      return request<{ success: boolean }>("/api/channels/slack", { method: "DELETE" });
    },
    testEmail(config: { host: string; port: number; user: string; password: string; from: string }) {
      return request<{ success: boolean }>("/api/channels/email/test", {
        method: "POST",
        body: JSON.stringify(config),
      });
    },
    saveEmail(config: { host: string; port: number; user: string; password: string; from: string }) {
      return request<{ success: boolean }>("/api/channels/email", {
        method: "PUT",
        body: JSON.stringify(config),
      });
    },
    deleteEmail() {
      return request<{ success: boolean }>("/api/channels/email", { method: "DELETE" });
    },
  },
  whatsapp: {
    status() {
      return request<{ connected: boolean; phoneNumber: string | null }>("/api/channels/whatsapp");
    },
    cancelPairing() {
      return request<{ success: boolean }>("/api/channels/whatsapp/pair", { method: "DELETE" });
    },
    disconnect() {
      return request<{ success: boolean }>("/api/channels/whatsapp", { method: "DELETE" });
    },
  },
  settings: {
    identity() {
      return request<{ orgName: string | null; botName: string }>("/api/settings/identity");
    },
  },
  users: {
    list() {
      return request<{ users: User[] }>("/api/users");
    },
    create(data: { name: string; email?: string | null; whatsappNumber?: string | null }) {
      return request<{ user: User; verificationSent?: boolean }>("/api/users", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    update(id: string, data: { name?: string; email?: string | null; whatsappNumber?: string | null }) {
      return request<{ user: User; verificationSent?: boolean }>(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    resendVerification(id: string) {
      return request<{ success: boolean; sent: boolean }>(`/api/users/${id}/verification`, {
        method: "POST",
      });
    },
    remove(id: string) {
      return request<{ success: boolean }>(`/api/users/${id}`, {
        method: "DELETE",
      });
    },
  },
  scheduledTasks: {
    async list() {
      const res = await request<{ tasks: ScheduledTaskListItem[] }>("/api/scheduled-tasks");
      return res.tasks;
    },
    async pause(id: string) {
      const res = await request<{ task: ScheduledTaskListItem }>(`/api/scheduled-tasks/${id}/pause`, {
        method: "POST",
      });
      return res.task;
    },
    async resume(id: string) {
      const res = await request<{ task: ScheduledTaskListItem }>(`/api/scheduled-tasks/${id}/resume`, {
        method: "POST",
      });
      return res.task;
    },
    remove(id: string) {
      return request<{ success: true }>(`/api/scheduled-tasks/${id}`, {
        method: "DELETE",
      });
    },
  },
  skills: {
    list() {
      return request<{ skills: SkillRecord[] }>("/api/skills");
    },
    get(id: string) {
      return request<{ skill: SkillRecord }>(`/api/skills/${id}`);
    },
    create(data: { name: string; description: string; category: SkillRecord["category"]; body: string; id?: string }) {
      return request<{ skill: SkillRecord }>("/api/skills", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    update(id: string, data: { name: string; description: string; category: SkillRecord["category"]; body: string }) {
      return request<{ skill: SkillRecord }>(`/api/skills/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    remove(id: string) {
      return request<{ success: true }>(`/api/skills/${id}`, { method: "DELETE" });
    },
  },
  mcpServers: {
    async list() {
      const res = await request<{ servers: McpServerRecord[] }>("/api/mcp-servers");
      return res.servers;
    },
    async add(data: {
      displayName: string;
      url: string;
      apiUrl?: string;
      credentials: Record<string, unknown>;
      type?: string;
      mode?: "mcp" | "skill";
    }) {
      const res = await request<{ server: McpServerRecord }>("/api/mcp-servers", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.server;
    },
    update(
      id: string,
      data: {
        displayName?: string;
        url?: string;
        apiUrl?: string | null;
        credentials?: Record<string, unknown>;
        mode?: "mcp" | "skill";
      },
    ) {
      return request<void>(`/api/mcp-servers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    remove(id: string) {
      return request<void>(`/api/mcp-servers/${id}`, { method: "DELETE" });
    },
    testConnection(url: string, credentials: string) {
      return request<{ status: "ok" | "error"; toolCount?: number; error?: string }>(
        "/api/mcp-servers/connection-tests",
        {
          method: "POST",
          body: JSON.stringify({ url, credentials }),
        },
      );
    },
    testConnectionById(serverId: string) {
      return request<{ status: "ok" | "error"; toolCount?: number; error?: string }>(
        `/api/mcp-servers/${serverId}/connection-tests`,
        { method: "POST" },
      );
    },
    listApps(providerId: string, query?: string, limit?: number, after?: string) {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (limit) params.set("limit", String(limit));
      if (after) params.set("after", after);
      const qs = params.toString();
      return request<{ apps: IntegrationApp[]; pageInfo: PageInfo }>(
        `/api/mcp-servers/${providerId}/apps${qs ? `?${qs}` : ""}`,
      );
    },
    createConnection(providerId: string, appId: string, callbackUrl?: string) {
      return request<{ redirectUrl: string }>(`/api/mcp-servers/${providerId}/connections`, {
        method: "POST",
        body: JSON.stringify({ appId, callbackUrl }),
      });
    },
    async listConnections(providerId: string) {
      const res = await request<{ connections: IntegrationConnection[] }>(`/api/mcp-servers/${providerId}/connections`);
      return res.connections;
    },
    removeConnection(providerId: string, connectionId: string) {
      return request<void>(`/api/mcp-servers/${providerId}/connections/${connectionId}`, {
        method: "DELETE",
      });
    },
  },
};
