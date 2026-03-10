/**
 * Typed API client for the control plane backend.
 * All methods throw on non-2xx responses with the standard error shape.
 */

import type { SkillCategory } from "@/lib/skills-data";

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

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
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
    create(data: { name: string; whatsappNumber: string }) {
      return request<{ user: User }>("/api/users", {
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
};
