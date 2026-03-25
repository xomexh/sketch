import { describe, expect, it, vi } from "vitest";
import { type EventSink, TelemetryEmitter } from "./emitter";
import type { TelemetryEvent } from "./types";

function makeLogger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Parameters<
    typeof TelemetryEmitter.prototype.emit
  > extends never[]
    ? never
    : import("../logger").Logger;
}

function makeEvent(): TelemetryEvent {
  return {
    eventType: "agent_run",
    timestamp: Date.now(),
    payload: {
      runId: "run-1",
      userId: null,
      platform: "slack",
      contextType: "dm",
      workspaceKey: "user-1",
      threadKey: null,
      sessionId: "sess-1",
      isResumedSession: false,
      costUsd: 0.01,
      durationMs: 1000,
      durationApiMs: 900,
      numTurns: 1,
      stopReason: "end_turn",
      errorSubtype: null,
      isError: false,
      messageSent: true,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
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
    },
  };
}

function makeMockSink(
  name = "mock",
): EventSink & { events: TelemetryEvent[]; flushCalled: boolean; closeCalled: boolean } {
  const events: TelemetryEvent[] = [];
  return {
    name,
    events,
    flushCalled: false,
    closeCalled: false,
    emit(event: TelemetryEvent) {
      events.push(event);
    },
    async flush() {
      this.flushCalled = true;
    },
    async close() {
      this.closeCalled = true;
    },
  };
}

describe("TelemetryEmitter", () => {
  it("fans out events to all sinks", () => {
    const sink1 = makeMockSink();
    const sink2 = makeMockSink();
    const emitter = new TelemetryEmitter([sink1, sink2], makeLogger());

    const event = makeEvent();
    emitter.emit(event);

    expect(sink1.events).toHaveLength(1);
    expect(sink2.events).toHaveLength(1);
    expect(sink1.events[0]).toBe(event);
    expect(sink2.events[0]).toBe(event);
  });

  it("catches per-sink errors without affecting other sinks", () => {
    const logger = makeLogger();
    const brokenSink: EventSink = {
      name: "broken",
      emit() {
        throw new Error("sink broken");
      },
      async flush() {},
      async close() {},
    };
    const goodSink = makeMockSink();
    const emitter = new TelemetryEmitter([brokenSink, goodSink], logger);

    const event = makeEvent();
    emitter.emit(event);

    expect(goodSink.events).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), eventType: "agent_run" }),
      "Telemetry sink error",
    );
  });

  it("flush() calls flush on all sinks", async () => {
    const sink1 = makeMockSink();
    const sink2 = makeMockSink();
    const emitter = new TelemetryEmitter([sink1, sink2], makeLogger());

    await emitter.flush();

    expect(sink1.flushCalled).toBe(true);
    expect(sink2.flushCalled).toBe(true);
  });

  it("close() calls close on all sinks", async () => {
    const sink1 = makeMockSink();
    const sink2 = makeMockSink();
    const emitter = new TelemetryEmitter([sink1, sink2], makeLogger());

    await emitter.close();

    expect(sink1.closeCalled).toBe(true);
    expect(sink2.closeCalled).toBe(true);
  });

  it("flush() tolerates sink flush failures", async () => {
    const failSink: EventSink = {
      name: "fail",
      emit() {},
      async flush() {
        throw new Error("flush failed");
      },
      async close() {},
    };
    const goodSink = makeMockSink();
    const emitter = new TelemetryEmitter([failSink, goodSink], makeLogger());

    await expect(emitter.flush()).resolves.not.toThrow();
    expect(goodSink.flushCalled).toBe(true);
  });

  it("works with zero sinks", () => {
    const emitter = new TelemetryEmitter([], makeLogger());
    expect(() => emitter.emit(makeEvent())).not.toThrow();
  });
});
