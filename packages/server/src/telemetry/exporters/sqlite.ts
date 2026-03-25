/**
 * SqliteSpanExporter — persists OTel spans to SQLite via the agent-runs repository.
 *
 * Buffers execute_tool child spans by traceId. When the parent invoke_agent span
 * arrives, the exporter writes the agent_run row + all its tool_call rows together.
 *
 * IMPORTANT: BatchSpanProcessor does NOT guarantee parent and child spans arrive
 * in the same export() call. This exporter handles split-batch delivery correctly
 * by buffering tool spans until the parent arrives.
 *
 * IMPORTANT: export() awaits all DB writes before calling resultCallback, so that
 * BatchSpanProcessor.shutdown() correctly waits for pending writes to complete
 * before the DB connection is destroyed.
 */
import { ExportResultCode } from "@opentelemetry/core";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { createAgentRunsRepo } from "../../db/repositories/agent-runs";
import type { Logger } from "../../logger";

export class SqliteSpanExporter implements SpanExporter {
  private repo: ReturnType<typeof createAgentRunsRepo>;
  private logger: Logger;
  /**
   * Buffers execute_tool spans by traceId until the parent invoke_agent span arrives.
   * BatchSpanProcessor batches by time/count, not by trace — parent and children
   * may arrive in different export() calls.
   */
  private pendingToolSpans = new Map<string, ReadableSpan[]>();

  constructor(repo: ReturnType<typeof createAgentRunsRepo>, logger: Logger) {
    this.repo = repo;
    this.logger = logger;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const writePromises: Promise<void>[] = [];

    for (const span of spans) {
      const opName = span.attributes["gen_ai.operation.name"];
      const traceId = span.spanContext().traceId;

      if (opName === "execute_tool") {
        const batch = this.pendingToolSpans.get(traceId) ?? [];
        batch.push(span);
        this.pendingToolSpans.set(traceId, batch);
      } else if (opName === "invoke_agent") {
        const toolSpans = this.pendingToolSpans.get(traceId) ?? [];
        this.pendingToolSpans.delete(traceId);
        writePromises.push(this.persistRun(span, toolSpans));
      }
    }

    if (writePromises.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
    } else {
      Promise.all(writePromises)
        .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
        .catch(() => resultCallback({ code: ExportResultCode.FAILED }));
    }
  }

  async shutdown(): Promise<void> {
    // BatchSpanProcessor calls forceFlush before shutdown,
    // so all pending spans are exported before this is called.
  }

  private async persistRun(run: ReadableSpan, toolSpans: ReadableSpan[]): Promise<void> {
    const a = run.attributes;
    const durationMs = Math.round(run.duration[0] * 1000 + run.duration[1] / 1e6);
    const runId = a["sketch.run_id"] as string;

    try {
      await this.repo.insertRun({
        id: runId,
        user_id: (a["sketch.user_id"] as string) || null,
        platform: a["sketch.platform"] as string,
        context_type: a["sketch.context_type"] as string,
        workspace_key: a["sketch.workspace_key"] as string,
        thread_key: (a["sketch.thread_key"] as string) || null,
        session_id: (a["gen_ai.conversation.id"] as string) || null,
        is_resumed_session: a["sketch.is_resumed_session"] ? 1 : 0,
        cost_usd: (a["sketch.cost_usd"] as number) ?? 0,
        duration_ms: durationMs,
        duration_api_ms: (a["sketch.duration_api_ms"] as number) ?? 0,
        num_turns: (a["sketch.num_turns"] as number) ?? 0,
        stop_reason: (a["gen_ai.response.finish_reasons"] as string[])?.[0] ?? null,
        error_subtype: (a["sketch.error_subtype"] as string) || null,
        is_error: run.status.code === 2 ? 1 : 0,
        message_sent: a["sketch.message_sent"] ? 1 : 0,
        input_tokens: (a["gen_ai.usage.input_tokens"] as number) ?? 0,
        output_tokens: (a["gen_ai.usage.output_tokens"] as number) ?? 0,
        cache_read_tokens: (a["gen_ai.usage.cache_read_input_tokens"] as number) ?? 0,
        cache_creation_tokens: (a["gen_ai.usage.cache_creation_input_tokens"] as number) ?? 0,
        web_search_requests: (a["sketch.web_search_requests"] as number) ?? 0,
        web_fetch_requests: (a["sketch.web_fetch_requests"] as number) ?? 0,
        model: (a["gen_ai.response.model"] as string) || null,
        total_attachments: (a["sketch.total_attachments"] as number) ?? 0,
        image_count: (a["sketch.image_count"] as number) ?? 0,
        non_image_count: (a["sketch.non_image_count"] as number) ?? 0,
        mime_types: (a["sketch.mime_types"] as string) ?? "[]",
        file_sizes: (a["sketch.file_sizes"] as string) ?? "[]",
        prompt_mode: (a["sketch.prompt_mode"] as string) ?? "text",
        pending_uploads: (a["sketch.pending_uploads"] as number) ?? 0,
      });

      if (toolSpans.length > 0) {
        await this.repo.insertToolCalls(
          toolSpans.map((t) => ({
            agent_run_id: runId,
            tool_name: t.attributes["gen_ai.tool.name"] as string,
            skill_name: (t.attributes["sketch.skill.name"] as string) || null,
          })),
        );
      }

      this.logger.debug(
        {
          runId,
          platform: a["sketch.platform"],
          costUsd: a["sketch.cost_usd"],
          toolCallCount: toolSpans.length,
        },
        "Telemetry: persisted agent_run",
      );
    } catch (err) {
      this.logger.error({ err }, "Failed to persist agent run usage");
      throw err;
    }
  }
}
