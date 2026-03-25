import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it, vi } from "vitest";
import { SqliteSpanExporter } from "./sqlite";

function makeLogger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as import("../../logger").Logger;
}

function makeMockRepo() {
  return {
    insertRun: vi.fn().mockResolvedValue("run-id"),
    insertToolCalls: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSpan(
  attrs: Record<string, unknown>,
  overrides?: Partial<{ traceId: string; statusCode: number; duration: [number, number] }>,
): ReadableSpan {
  return {
    spanContext: () => ({
      traceId: overrides?.traceId ?? "trace-1",
      spanId: "span-1",
      traceFlags: 1,
    }),
    attributes: attrs,
    duration: overrides?.duration ?? [2, 500000000],
    status: { code: overrides?.statusCode ?? 0 },
    name: "",
    kind: 0,
    startTime: [0, 0],
    endTime: [2, 500000000],
    ended: true,
    resource: { attributes: {} },
    instrumentationLibrary: { name: "test" },
    events: [],
    links: [],
    parentSpanId: undefined,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as ReadableSpan;
}

function makeAgentRunSpan(overrides?: {
  traceId?: string;
  statusCode?: number;
  attrs?: Record<string, unknown>;
}): ReadableSpan {
  return makeSpan(
    {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.provider.name": "anthropic",
      "gen_ai.response.model": "claude-sonnet-4-20250514",
      "gen_ai.usage.input_tokens": 500,
      "gen_ai.usage.output_tokens": 200,
      "gen_ai.usage.cache_read_input_tokens": 50,
      "gen_ai.usage.cache_creation_input_tokens": 10,
      "gen_ai.response.finish_reasons": ["end_turn"],
      "gen_ai.conversation.id": "sess-1",
      "sketch.run_id": "run-1",
      "sketch.platform": "slack",
      "sketch.context_type": "dm",
      "sketch.user_id": "user-1",
      "sketch.workspace_key": "user-1",
      "sketch.thread_key": "",
      "sketch.cost_usd": 0.005,
      "sketch.num_turns": 2,
      "sketch.duration_api_ms": 1800,
      "sketch.error_subtype": "",
      "sketch.is_resumed_session": false,
      "sketch.message_sent": true,
      "sketch.web_search_requests": 0,
      "sketch.web_fetch_requests": 0,
      "sketch.total_attachments": 0,
      "sketch.image_count": 0,
      "sketch.non_image_count": 0,
      "sketch.mime_types": "[]",
      "sketch.file_sizes": "[]",
      "sketch.prompt_mode": "text",
      "sketch.pending_uploads": 0,
      ...overrides?.attrs,
    },
    { traceId: overrides?.traceId, statusCode: overrides?.statusCode },
  );
}

function makeToolCallSpan(toolName: string, skillName: string | null, traceId = "trace-1"): ReadableSpan {
  const attrs: Record<string, unknown> = {
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": toolName,
  };
  if (skillName) attrs["sketch.skill.name"] = skillName;
  return makeSpan(attrs, { traceId });
}

describe("SqliteSpanExporter", () => {
  it("persists invoke_agent span to repo", async () => {
    const repo = makeMockRepo();
    const exporter = new SqliteSpanExporter(repo, makeLogger());

    const code = await new Promise<number>((resolve) => {
      exporter.export([makeAgentRunSpan()], (result) => resolve(result.code));
    });

    expect(code).toBe(ExportResultCode.SUCCESS);
    expect(repo.insertRun).toHaveBeenCalledOnce();
    expect(repo.insertRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-1",
        platform: "slack",
        context_type: "dm",
        cost_usd: 0.005,
        is_error: 0,
        message_sent: 1,
        model: "claude-sonnet-4-20250514",
        input_tokens: 500,
        output_tokens: 200,
        duration_ms: 2500,
      }),
    );
  });

  it("buffers tool spans and persists them when parent arrives", async () => {
    const repo = makeMockRepo();
    const exporter = new SqliteSpanExporter(repo, makeLogger());

    const toolSpans = [
      makeToolCallSpan("Bash", null, "trace-2"),
      makeToolCallSpan("Skill", "canvas", "trace-2"),
      makeToolCallSpan("Read", null, "trace-2"),
    ];
    const parentSpan = makeAgentRunSpan({ traceId: "trace-2", attrs: { "sketch.run_id": "run-2" } });

    // Export tool spans first (no writes yet)
    await new Promise<void>((resolve) => {
      exporter.export(toolSpans, () => resolve());
    });
    expect(repo.insertRun).not.toHaveBeenCalled();

    // Export parent span (triggers flush)
    await new Promise<void>((resolve) => {
      exporter.export([parentSpan], () => resolve());
    });

    expect(repo.insertRun).toHaveBeenCalledOnce();
    expect(repo.insertToolCalls).toHaveBeenCalledOnce();
    expect(repo.insertToolCalls).toHaveBeenCalledWith([
      { agent_run_id: "run-2", tool_name: "Bash", skill_name: null },
      { agent_run_id: "run-2", tool_name: "Skill", skill_name: "canvas" },
      { agent_run_id: "run-2", tool_name: "Read", skill_name: null },
    ]);
  });

  it("handles all spans in the same batch (tool calls + parent)", async () => {
    const repo = makeMockRepo();
    const exporter = new SqliteSpanExporter(repo, makeLogger());

    const spans = [
      makeToolCallSpan("Bash", null, "trace-3"),
      makeToolCallSpan("Skill", "canvas", "trace-3"),
      makeAgentRunSpan({ traceId: "trace-3", attrs: { "sketch.run_id": "run-3" } }),
    ];

    await new Promise<void>((resolve) => {
      exporter.export(spans, () => resolve());
    });

    expect(repo.insertRun).toHaveBeenCalledOnce();
    expect(repo.insertToolCalls).toHaveBeenCalledWith([
      { agent_run_id: "run-3", tool_name: "Bash", skill_name: null },
      { agent_run_id: "run-3", tool_name: "Skill", skill_name: "canvas" },
    ]);
  });

  it("handles error runs (status.code = 2)", async () => {
    const repo = makeMockRepo();
    const exporter = new SqliteSpanExporter(repo, makeLogger());

    const span = makeAgentRunSpan({ statusCode: 2, attrs: { "sketch.run_id": "run-err" } });

    await new Promise<void>((resolve) => {
      exporter.export([span], () => resolve());
    });

    expect(repo.insertRun).toHaveBeenCalledWith(expect.objectContaining({ id: "run-err", is_error: 1 }));
    expect(repo.insertToolCalls).not.toHaveBeenCalled();
  });

  it("keeps tool spans separate between traces", async () => {
    const repo = makeMockRepo();
    const exporter = new SqliteSpanExporter(repo, makeLogger());

    const spans = [
      makeToolCallSpan("Bash", null, "trace-a"),
      makeToolCallSpan("Read", null, "trace-b"),
      makeAgentRunSpan({ traceId: "trace-a", attrs: { "sketch.run_id": "run-a" } }),
    ];

    await new Promise<void>((resolve) => {
      exporter.export(spans, () => resolve());
    });

    // Only trace-a should be persisted (trace-b's parent hasn't arrived)
    expect(repo.insertRun).toHaveBeenCalledOnce();
    expect(repo.insertToolCalls).toHaveBeenCalledWith([{ agent_run_id: "run-a", tool_name: "Bash", skill_name: null }]);

    // Now send trace-b's parent
    await new Promise<void>((resolve) => {
      exporter.export([makeAgentRunSpan({ traceId: "trace-b", attrs: { "sketch.run_id": "run-b" } })], () => resolve());
    });

    expect(repo.insertRun).toHaveBeenCalledTimes(2);
    expect(repo.insertToolCalls).toHaveBeenCalledTimes(2);
    expect(repo.insertToolCalls).toHaveBeenLastCalledWith([
      { agent_run_id: "run-b", tool_name: "Read", skill_name: null },
    ]);
  });

  it("awaits DB writes before calling resultCallback", async () => {
    const repo = makeMockRepo();
    let insertRunResolved = false;
    repo.insertRun.mockImplementation(() => {
      return new Promise<string>((resolve) => {
        setTimeout(() => {
          insertRunResolved = true;
          resolve("run-id");
        }, 50);
      });
    });

    const exporter = new SqliteSpanExporter(repo, makeLogger());

    const code = await new Promise<number>((resolve) => {
      exporter.export([makeAgentRunSpan()], (result) => resolve(result.code));
    });

    expect(code).toBe(ExportResultCode.SUCCESS);
    expect(insertRunResolved).toBe(true);
  });

  it("reports FAILED when DB write throws", async () => {
    const repo = makeMockRepo();
    const logger = makeLogger();
    repo.insertRun.mockRejectedValueOnce(new Error("DB write failed"));

    const exporter = new SqliteSpanExporter(repo, logger);

    const code = await new Promise<number>((resolve) => {
      exporter.export([makeAgentRunSpan()], (result) => resolve(result.code));
    });

    expect(code).toBe(ExportResultCode.FAILED);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Failed to persist agent run usage",
    );
  });

  it("maps boolean attributes to integers correctly", async () => {
    const repo = makeMockRepo();
    const exporter = new SqliteSpanExporter(repo, makeLogger());

    const span = makeAgentRunSpan({
      attrs: { "sketch.is_resumed_session": true, "sketch.message_sent": true },
    });

    await new Promise<void>((resolve) => {
      exporter.export([span], () => resolve());
    });

    expect(repo.insertRun).toHaveBeenCalledWith(
      expect.objectContaining({ is_resumed_session: 1, message_sent: 1, is_error: 0 }),
    );
  });

  it("calculates duration from span HrTime correctly", async () => {
    const repo = makeMockRepo();
    const exporter = new SqliteSpanExporter(repo, makeLogger());

    // 3 seconds + 250ms = 3250ms
    const span = makeSpan({ ...makeAgentRunSpan().attributes }, { duration: [3, 250000000] });

    await new Promise<void>((resolve) => {
      exporter.export([span], () => resolve());
    });

    expect(repo.insertRun).toHaveBeenCalledWith(expect.objectContaining({ duration_ms: 3250 }));
  });
});
