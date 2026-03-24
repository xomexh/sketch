import { describe, expect, it, vi } from "vitest";
import { extractAssistantText, runAgent } from "./runner";

// Mock the SDK so runAgent can be tested without spawning subprocesses
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn().mockImplementation(() => {
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "sess-test" };
      yield { type: "result", session_id: "sess-test", total_cost_usd: 0 };
    })();
  }),
}));

vi.mock("./sessions", () => ({
  getSessionId: vi.fn().mockResolvedValue(undefined),
  saveSessionId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./sketch-tools", () => {
  class MockUploadCollector {
    drain() {
      return [];
    }
  }
  return {
    UploadCollector: MockUploadCollector,
    createSketchMcpServer: vi.fn().mockReturnValue({}),
  };
});

vi.mock("./permissions", () => ({
  createCanUseTool: vi.fn().mockReturnValue(() => ({ behavior: "allow" as const })),
}));

describe("extractAssistantText", () => {
  it("extracts text from a standard assistant message", () => {
    const message = {
      type: "assistant",
      message: { content: [{ type: "text", text: "hello world" }] },
    };
    expect(extractAssistantText(message)).toBe("hello world");
  });

  it("returns null for non-assistant message types", () => {
    expect(extractAssistantText({ type: "system", subtype: "init", session_id: "abc" })).toBeNull();
    expect(extractAssistantText({ type: "result", session_id: "abc", total_cost_usd: 0 })).toBeNull();
    expect(extractAssistantText({ type: "user" })).toBeNull();
  });

  it("returns null when content is only tool_use blocks", () => {
    const message = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
      },
    };
    expect(extractAssistantText(message)).toBeNull();
  });

  it("returns null when text is empty", () => {
    const message = {
      type: "assistant",
      message: { content: [{ type: "text", text: "" }] },
    };
    expect(extractAssistantText(message)).toBeNull();
  });

  it("returns null when text is only whitespace", () => {
    const message = {
      type: "assistant",
      message: { content: [{ type: "text", text: "   \n\t  " }] },
    };
    expect(extractAssistantText(message)).toBeNull();
  });

  it("extracts text from message with mixed text and tool_use blocks", () => {
    const message = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me check that for you." },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/foo" } },
        ],
      },
    };
    expect(extractAssistantText(message)).toBe("Let me check that for you.");
  });

  it("concatenates multiple text blocks with newlines", () => {
    const message = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "First part." },
          { type: "text", text: "Second part." },
        ],
      },
    };
    expect(extractAssistantText(message)).toBe("First part.\nSecond part.");
  });

  it("returns null for null/undefined/primitive inputs", () => {
    expect(extractAssistantText(null)).toBeNull();
    expect(extractAssistantText(undefined)).toBeNull();
    expect(extractAssistantText("string")).toBeNull();
    expect(extractAssistantText(42)).toBeNull();
  });

  it("returns null when message property is missing", () => {
    expect(extractAssistantText({ type: "assistant" })).toBeNull();
  });

  it("returns null when content is not an array", () => {
    const message = {
      type: "assistant",
      message: { content: "not an array" },
    };
    expect(extractAssistantText(message)).toBeNull();
  });
});

describe("runAgent", () => {
  it("forwards userPhone to buildSystemContext (phone appears in system prompt append)", async () => {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const capturedOptions: unknown[] = [];
    vi.mocked(query).mockImplementation(((args: unknown) => {
      capturedOptions.push(args);
      return (async function* () {
        yield { type: "system", subtype: "init", session_id: "sess-phone-test" };
        yield { type: "result", session_id: "sess-phone-test", total_cost_usd: 0 };
      })();
    }) as unknown as typeof query);

    await runAgent({
      db: {} as Parameters<typeof runAgent>[0]["db"],
      workspaceKey: "u-phone-test",
      userMessage: "hello",
      workspaceDir: "/tmp/ws-phone-test",
      userName: "Alice",
      userEmail: "alice@example.com",
      userPhone: "+1234567890",
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Parameters<
        typeof runAgent
      >[0]["logger"],
      platform: "whatsapp",
      onMessage: vi.fn().mockResolvedValue(undefined),
    });

    expect(capturedOptions.length).toBeGreaterThan(0);
    const callArgs = capturedOptions[capturedOptions.length - 1] as {
      options: { systemPrompt: { append: string } };
    };
    expect(callArgs.options.systemPrompt.append).toContain("Phone: +1234567890");
  });
});
