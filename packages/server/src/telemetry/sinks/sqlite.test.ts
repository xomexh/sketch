import { describe, expect, it, vi } from "vitest";
import type { AgentRunPayload, TelemetryEvent, ToolCallPayload } from "../types";
import { SqliteSink } from "./sqlite";

function makeLogger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as import("../../logger").Logger;
}

function makeMockRepo() {
  return {
    insertRun: vi.fn().mockResolvedValue("run-id"),
    insertToolCalls: vi.fn().mockResolvedValue(undefined),
  };
}

function makeAgentRunPayload(overrides?: Partial<AgentRunPayload>): AgentRunPayload {
  return {
    runId: "run-1",
    userId: "user-1",
    platform: "slack",
    contextType: "dm",
    workspaceKey: "user-1",
    threadKey: null,
    sessionId: "sess-1",
    isResumedSession: false,
    costUsd: 0.005,
    durationMs: 2000,
    durationApiMs: 1800,
    numTurns: 2,
    stopReason: "end_turn",
    errorSubtype: null,
    isError: false,
    messageSent: true,
    inputTokens: 500,
    outputTokens: 200,
    cacheReadTokens: 50,
    cacheCreationTokens: 10,
    webSearchRequests: 0,
    webFetchRequests: 0,
    model: "claude-sonnet-4-20250514",
    totalAttachments: 0,
    imageCount: 0,
    nonImageCount: 0,
    mimeTypes: [],
    fileSizes: [],
    promptMode: "text",
    pendingUploads: 0,
    ...overrides,
  };
}

function makeToolCallPayload(overrides?: Partial<ToolCallPayload>): ToolCallPayload {
  return {
    runId: "run-1",
    toolName: "Bash",
    skillName: null,
    ...overrides,
  };
}

function makeAgentRunEvent(payload?: Partial<AgentRunPayload>): TelemetryEvent {
  return { eventType: "agent_run", timestamp: Date.now(), payload: makeAgentRunPayload(payload) };
}

function makeToolCallEvent(payload?: Partial<ToolCallPayload>): TelemetryEvent {
  return { eventType: "tool_call", timestamp: Date.now(), payload: makeToolCallPayload(payload) };
}

describe("SqliteSink", () => {
  it("persists agent_run event to repo", async () => {
    const repo = makeMockRepo();
    const sink = new SqliteSink(repo, makeLogger());

    sink.emit(makeAgentRunEvent());

    // Fire-and-forget — wait a tick for the promise chain
    await new Promise((r) => setTimeout(r, 10));

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
      }),
    );
  });

  it("batches tool_call events and inserts them when agent_run arrives", async () => {
    const repo = makeMockRepo();
    const sink = new SqliteSink(repo, makeLogger());

    // Emit tool calls first
    sink.emit(makeToolCallEvent({ runId: "run-2", toolName: "Bash", skillName: null }));
    sink.emit(makeToolCallEvent({ runId: "run-2", toolName: "Skill", skillName: "canvas" }));
    sink.emit(makeToolCallEvent({ runId: "run-2", toolName: "Read", skillName: null }));

    // No writes yet — tool calls are batched
    expect(repo.insertRun).not.toHaveBeenCalled();
    expect(repo.insertToolCalls).not.toHaveBeenCalled();

    // Emit agent_run → triggers flush
    sink.emit(makeAgentRunEvent({ runId: "run-2" }));

    await new Promise((r) => setTimeout(r, 10));

    expect(repo.insertRun).toHaveBeenCalledOnce();
    expect(repo.insertToolCalls).toHaveBeenCalledOnce();
    expect(repo.insertToolCalls).toHaveBeenCalledWith([
      { agent_run_id: "run-2", tool_name: "Bash", skill_name: null },
      { agent_run_id: "run-2", tool_name: "Skill", skill_name: "canvas" },
      { agent_run_id: "run-2", tool_name: "Read", skill_name: null },
    ]);
  });

  it("handles error runs with no tool calls", async () => {
    const repo = makeMockRepo();
    const sink = new SqliteSink(repo, makeLogger());

    sink.emit(makeAgentRunEvent({ runId: "run-err", isError: true, costUsd: 0, durationMs: 50 }));

    await new Promise((r) => setTimeout(r, 10));

    expect(repo.insertRun).toHaveBeenCalledOnce();
    expect(repo.insertRun).toHaveBeenCalledWith(expect.objectContaining({ id: "run-err", is_error: 1, cost_usd: 0 }));
    expect(repo.insertToolCalls).not.toHaveBeenCalled();
  });

  it("does not insert tool_calls if array is empty", async () => {
    const repo = makeMockRepo();
    const sink = new SqliteSink(repo, makeLogger());

    // Agent run with no preceding tool call events
    sink.emit(makeAgentRunEvent({ runId: "run-no-tools" }));

    await new Promise((r) => setTimeout(r, 10));

    expect(repo.insertRun).toHaveBeenCalledOnce();
    expect(repo.insertToolCalls).not.toHaveBeenCalled();
  });

  it("keeps tool calls separate between different runIds", async () => {
    const repo = makeMockRepo();
    const sink = new SqliteSink(repo, makeLogger());

    sink.emit(makeToolCallEvent({ runId: "run-a", toolName: "Bash" }));
    sink.emit(makeToolCallEvent({ runId: "run-b", toolName: "Read" }));
    sink.emit(makeToolCallEvent({ runId: "run-a", toolName: "Skill", skillName: "canvas" }));

    // Flush run-a
    sink.emit(makeAgentRunEvent({ runId: "run-a" }));
    await new Promise((r) => setTimeout(r, 10));

    expect(repo.insertRun).toHaveBeenCalledOnce();
    expect(repo.insertToolCalls).toHaveBeenCalledWith([
      { agent_run_id: "run-a", tool_name: "Bash", skill_name: null },
      { agent_run_id: "run-a", tool_name: "Skill", skill_name: "canvas" },
    ]);

    // Flush run-b
    sink.emit(makeAgentRunEvent({ runId: "run-b" }));
    await new Promise((r) => setTimeout(r, 10));

    expect(repo.insertRun).toHaveBeenCalledTimes(2);
    expect(repo.insertToolCalls).toHaveBeenCalledTimes(2);
    expect(repo.insertToolCalls).toHaveBeenLastCalledWith([
      { agent_run_id: "run-b", tool_name: "Read", skill_name: null },
    ]);
  });

  it("logs error when repo.insertRun fails (fire-and-forget)", async () => {
    const logger = makeLogger();
    const repo = makeMockRepo();
    repo.insertRun.mockRejectedValueOnce(new Error("DB write failed"));
    const sink = new SqliteSink(repo, logger);

    sink.emit(makeAgentRunEvent());

    await new Promise((r) => setTimeout(r, 10));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Failed to persist agent run usage",
    );
  });

  it("maps boolean fields to integers correctly", async () => {
    const repo = makeMockRepo();
    const sink = new SqliteSink(repo, makeLogger());

    sink.emit(makeAgentRunEvent({ isResumedSession: true, isError: false, messageSent: true }));

    await new Promise((r) => setTimeout(r, 10));

    expect(repo.insertRun).toHaveBeenCalledWith(
      expect.objectContaining({ is_resumed_session: 1, is_error: 0, message_sent: 1 }),
    );
  });

  it("serializes mimeTypes and fileSizes as JSON", async () => {
    const repo = makeMockRepo();
    const sink = new SqliteSink(repo, makeLogger());

    sink.emit(makeAgentRunEvent({ mimeTypes: ["image/png", "text/csv"], fileSizes: [1024, 2048] }));

    await new Promise((r) => setTimeout(r, 10));

    expect(repo.insertRun).toHaveBeenCalledWith(
      expect.objectContaining({
        mime_types: '["image/png","text/csv"]',
        file_sizes: "[1024,2048]",
      }),
    );
  });
});
