/**
 * Telemetry event types.
 *
 * Uses a shared envelope (`TelemetryEvent`) with typed payloads.
 * Adding `deploymentId` (Phase 3) is a single field addition to the envelope.
 */

export type TelemetryEventType = "agent_run" | "tool_call";
// Phase 3 additions: "skill_lifecycle" | "message_received" | "session_lifecycle"

/**
 * Discriminated union — TypeScript narrows `payload` automatically when you
 * check `event.eventType`, eliminating the need for manual `as` casts in sinks.
 */
export type TelemetryEvent =
  | { eventType: "agent_run"; timestamp: number; payload: AgentRunPayload }
  | { eventType: "tool_call"; timestamp: number; payload: ToolCallPayload };

export interface AgentRunPayload {
  runId: string;
  userId: string | null;
  platform: string;
  contextType: string;
  workspaceKey: string;
  threadKey: string | null;
  sessionId: string | null;
  isResumedSession: boolean;
  costUsd: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  stopReason: string | null;
  errorSubtype: string | null;
  isError: boolean;
  messageSent: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
  model: string | null;
  totalAttachments: number;
  imageCount: number;
  nonImageCount: number;
  mimeTypes: string[];
  fileSizes: number[];
  promptMode: string;
  pendingUploads: number;
}

export interface ToolCallPayload {
  runId: string;
  toolName: string;
  skillName: string | null;
  // Phase 3 additions (all null for now):
  // outcome, denialReason, isMcp, mcpServer, appSlug,
  // componentKey, componentType, authType, executionOutcome
}
