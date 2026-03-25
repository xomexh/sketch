/**
 * SqliteSink — persists telemetry events to SQLite via the agent-runs repository.
 *
 * Tool call events are batched per runId in memory. When the corresponding
 * agent_run event arrives, the sink bulk-inserts the run + its tool calls.
 *
 * IMPORTANT: Emit ordering contract — tool_call events MUST be emitted BEFORE
 * the agent_run event for the same runId. The agent_run event triggers the flush.
 */
import type { createAgentRunsRepo } from "../../db/repositories/agent-runs";
import type { Logger } from "../../logger";
import type { EventSink } from "../emitter";
import type { AgentRunPayload, TelemetryEvent, ToolCallPayload } from "../types";

export class SqliteSink implements EventSink {
  readonly name = "sqlite";
  private repo: ReturnType<typeof createAgentRunsRepo>;
  private logger: Logger;
  /**
   * Batches tool_call events per runId, flushed when the agent_run event arrives.
   *
   * Edge case: if tool_call events are emitted but the corresponding agent_run
   * event never arrives (e.g., process crash mid-run), these entries leak in
   * memory. At our volumes (~5k runs/day) this is negligible.
   */
  private pendingToolCalls = new Map<string, ToolCallPayload[]>();

  constructor(repo: ReturnType<typeof createAgentRunsRepo>, logger: Logger) {
    this.repo = repo;
    this.logger = logger;
  }

  emit(event: TelemetryEvent): void {
    if (event.eventType === "tool_call") {
      const tc = event.payload;
      const batch = this.pendingToolCalls.get(tc.runId) ?? [];
      batch.push(tc);
      this.pendingToolCalls.set(tc.runId, batch);
      this.logger.debug(
        { runId: tc.runId, toolName: tc.toolName, skillName: tc.skillName },
        "Telemetry: batched tool_call",
      );
      return;
    }

    if (event.eventType === "agent_run") {
      const run = event.payload;
      const toolCalls = this.pendingToolCalls.get(run.runId) ?? [];
      this.pendingToolCalls.delete(run.runId);
      this.logger.debug(
        {
          runId: run.runId,
          platform: run.platform,
          contextType: run.contextType,
          userId: run.userId,
          isError: run.isError,
          costUsd: run.costUsd,
          durationMs: run.durationMs,
          numTurns: run.numTurns,
          model: run.model,
          toolCallCount: toolCalls.length,
        },
        "Telemetry: persisting agent_run",
      );
      this.persistRun(run, toolCalls);
    }
  }

  async flush(): Promise<void> {
    // Writes are fire-and-forget promises. Nothing to await.
  }

  async close(): Promise<void> {
    // No resources to release — connection owned by Kysely.
  }

  private persistRun(run: AgentRunPayload, toolCalls: ToolCallPayload[]): void {
    this.repo
      .insertRun({
        id: run.runId,
        user_id: run.userId,
        platform: run.platform,
        context_type: run.contextType,
        workspace_key: run.workspaceKey,
        thread_key: run.threadKey,
        session_id: run.sessionId,
        is_resumed_session: run.isResumedSession ? 1 : 0,
        cost_usd: run.costUsd,
        duration_ms: run.durationMs,
        duration_api_ms: run.durationApiMs,
        num_turns: run.numTurns,
        stop_reason: run.stopReason,
        error_subtype: run.errorSubtype,
        is_error: run.isError ? 1 : 0,
        message_sent: run.messageSent ? 1 : 0,
        input_tokens: run.inputTokens,
        output_tokens: run.outputTokens,
        cache_read_tokens: run.cacheReadTokens,
        cache_creation_tokens: run.cacheCreationTokens,
        web_search_requests: run.webSearchRequests,
        web_fetch_requests: run.webFetchRequests,
        model: run.model,
        total_attachments: run.totalAttachments,
        image_count: run.imageCount,
        non_image_count: run.nonImageCount,
        mime_types: JSON.stringify(run.mimeTypes),
        file_sizes: JSON.stringify(run.fileSizes),
        prompt_mode: run.promptMode,
        pending_uploads: run.pendingUploads,
      })
      .then(() => {
        if (toolCalls.length > 0) {
          return this.repo.insertToolCalls(
            toolCalls.map((tc) => ({
              agent_run_id: run.runId,
              tool_name: tc.toolName,
              skill_name: tc.skillName,
            })),
          );
        }
      })
      .catch((err) => this.logger.error({ err }, "Failed to persist agent run usage"));
  }
}
