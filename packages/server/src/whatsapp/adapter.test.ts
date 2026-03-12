import { describe, expect, it, vi } from "vitest";
import { QueueManager } from "../queue";
import { createTestConfig, flush } from "../test-utils";
import type { WhatsAppAdapterDeps } from "./adapter";
import { wireWhatsAppHandlers } from "./adapter";

// --- Fixtures ---

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "Alice",
    email: "alice@test.com",
    slack_user_id: null,
    whatsapp_number: "+1234567890",
    created_at: "2025-01-01",
    email_verified_at: null,
    ...overrides,
  };
}

function createMockWhatsApp(connected = true) {
  const handler = { fn: null as unknown };
  return {
    mock: {
      isConnected: connected,
      socket: {},
      onMessage: vi.fn().mockImplementation((fn) => {
        handler.fn = fn;
      }),
      sendText: vi.fn().mockResolvedValue(undefined),
      sendFile: vi.fn().mockResolvedValue(undefined),
      startComposing: vi.fn(),
      stopComposing: vi.fn(),
      getGroupMetadata: vi.fn().mockResolvedValue({ subject: "Test Group", desc: "A test group" }),
      getGroupName: vi.fn().mockResolvedValue("Test Group"),
    },
    getHandler: () => handler.fn as (msg: unknown) => Promise<void>,
  };
}

function makeDeps(overrides: Partial<WhatsAppAdapterDeps> = {}): WhatsAppAdapterDeps {
  return {
    config: createTestConfig({ DATA_DIR: "/tmp/test-data", PORT: 0, LOG_LEVEL: "error" }),
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as WhatsAppAdapterDeps["logger"],
    repos: {
      users: {
        findByWhatsappNumber: vi.fn().mockResolvedValue(makeUser()),
      } as unknown as WhatsAppAdapterDeps["repos"]["users"],
      settings: {
        get: vi.fn().mockResolvedValue({
          org_name: "TestOrg",
          bot_name: "TestBot",
        }),
      } as unknown as WhatsAppAdapterDeps["repos"]["settings"],
    },
    queue: new QueueManager(),
    groupBuffer: {
      append: vi.fn(),
      drain: vi.fn().mockReturnValue([]),
    } as unknown as WhatsAppAdapterDeps["groupBuffer"],
    runAgent: vi.fn().mockResolvedValue({
      messageSent: true,
      sessionId: "sess-1",
      costUsd: 0.01,
      pendingUploads: [],
    }),
    buildMcpServers: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

// Stub workspace to avoid filesystem access
vi.mock("../agent/workspace", () => ({
  ensureWorkspace: vi.fn().mockResolvedValue("/tmp/test-data/workspaces/u1"),
  ensureChannelWorkspace: vi.fn().mockResolvedValue("/tmp/test-data/workspaces/channel-C1"),
  ensureGroupWorkspace: vi.fn().mockResolvedValue("/tmp/test-data/workspaces/wa-group-g1"),
}));

// Stub file download
vi.mock("../files", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    downloadWhatsAppMedia: vi.fn().mockResolvedValue({
      originalName: "photo.jpg",
      mimeType: "image/jpeg",
      localPath: "/tmp/photo.jpg",
      sizeBytes: 5000,
    }),
  };
});

describe("whatsapp/adapter", () => {
  describe("DM handler", () => {
    it("rejects unauthorized users", async () => {
      const deps = makeDeps();
      vi.mocked(deps.repos.users.findByWhatsappNumber).mockResolvedValue(undefined);
      const { mock, getHandler } = createMockWhatsApp();
      wireWhatsAppHandlers(mock as never, deps);
      const handler = getHandler();

      await handler({
        type: "dm",
        text: "hello",
        jid: "1234@s.whatsapp.net",
        messageId: "m1",
        pushName: "Bob",
        rawMessage: {},
        phoneNumber: "+1234567890",
      });

      expect(mock.sendText).toHaveBeenCalledWith(
        "1234@s.whatsapp.net",
        "Sorry, you're not authorized to use this bot. Contact your admin to get access.",
      );
      expect(deps.runAgent).not.toHaveBeenCalled();
    });

    it("runs agent for authorized DM users", async () => {
      const deps = makeDeps();
      const { mock, getHandler } = createMockWhatsApp();
      wireWhatsAppHandlers(mock as never, deps);
      const handler = getHandler();

      await handler({
        type: "dm",
        text: "hello",
        jid: "1234@s.whatsapp.net",
        messageId: "m1",
        pushName: "Alice",
        rawMessage: {},
        phoneNumber: "+1234567890",
      });
      await flush();

      expect(deps.runAgent).toHaveBeenCalledOnce();
      const agentCall = vi.mocked(deps.runAgent).mock.calls[0][0];
      expect(agentCall.userMessage).toBe("hello");
      expect(agentCall.platform).toBe("whatsapp");
      expect(agentCall.userName).toBe("Alice");
    });

    it("starts and stops composing indicator", async () => {
      const deps = makeDeps();
      const { mock, getHandler } = createMockWhatsApp();
      wireWhatsAppHandlers(mock as never, deps);
      const handler = getHandler();

      await handler({
        type: "dm",
        text: "hello",
        jid: "1234@s.whatsapp.net",
        messageId: "m1",
        pushName: "Alice",
        rawMessage: {},
        phoneNumber: "+1234567890",
      });
      await flush();

      expect(mock.startComposing).toHaveBeenCalledWith("1234@s.whatsapp.net");
      expect(mock.stopComposing).toHaveBeenCalledWith("1234@s.whatsapp.net");
    });

    it("sends error message on agent failure", async () => {
      const deps = makeDeps({
        runAgent: vi.fn().mockRejectedValue(new Error("boom")),
      });
      const { mock, getHandler } = createMockWhatsApp();
      wireWhatsAppHandlers(mock as never, deps);
      const handler = getHandler();

      await handler({
        type: "dm",
        text: "crash",
        jid: "1234@s.whatsapp.net",
        messageId: "m1",
        pushName: "Alice",
        rawMessage: {},
        phoneNumber: "+1234567890",
      });
      await flush();

      expect(mock.sendText).toHaveBeenCalledWith("1234@s.whatsapp.net", "Something went wrong, try again.");
    });

    it("uploads pending files after agent run", async () => {
      const deps = makeDeps({
        runAgent: vi.fn().mockResolvedValue({
          messageSent: true,
          sessionId: "s1",
          costUsd: 0,
          pendingUploads: ["/tmp/out.pdf"],
        }),
      });
      const { mock, getHandler } = createMockWhatsApp();
      wireWhatsAppHandlers(mock as never, deps);
      const handler = getHandler();

      await handler({
        type: "dm",
        text: "make pdf",
        jid: "1234@s.whatsapp.net",
        messageId: "m1",
        pushName: "Alice",
        rawMessage: {},
        phoneNumber: "+1234567890",
      });
      await flush();

      expect(mock.sendFile).toHaveBeenCalledWith("1234@s.whatsapp.net", "/tmp/out.pdf", "application/pdf", "out.pdf");
    });

    it("passes MCP servers to agent for DMs", async () => {
      const mcpServers = { canvas: { type: "http" as const, url: "https://mcp.test" } };
      const deps = makeDeps({
        buildMcpServers: vi.fn().mockResolvedValue(mcpServers),
      });
      const { mock, getHandler } = createMockWhatsApp();
      wireWhatsAppHandlers(mock as never, deps);
      const handler = getHandler();

      await handler({
        type: "dm",
        text: "hello",
        jid: "1234@s.whatsapp.net",
        messageId: "m1",
        pushName: "Alice",
        rawMessage: {},
        phoneNumber: "+1234567890",
      });
      await flush();

      const agentCall = vi.mocked(deps.runAgent).mock.calls[0][0];
      expect(agentCall.integrationMcpServers).toEqual(mcpServers);
    });
  });

  describe("group handler", () => {
    it("buffers non-mention group messages", async () => {
      const deps = makeDeps();
      const { mock, getHandler } = createMockWhatsApp();
      wireWhatsAppHandlers(mock as never, deps);
      const handler = getHandler();

      await handler({
        type: "group",
        text: "random chat",
        jid: "group@g.us",
        messageId: "m1",
        pushName: "Bob",
        rawMessage: {},
        isMentioned: false,
        senderJid: "5555@s.whatsapp.net",
      });

      expect(deps.groupBuffer.append).toHaveBeenCalledWith(
        "group@g.us",
        expect.objectContaining({ text: "random chat" }),
      );
      expect(deps.runAgent).not.toHaveBeenCalled();
    });

    it("uses user name from DB when available for buffered messages", async () => {
      const deps = makeDeps();
      vi.mocked(deps.repos.users.findByWhatsappNumber).mockResolvedValue(makeUser({ name: "DB Alice" }));
      const { mock, getHandler } = createMockWhatsApp();
      wireWhatsAppHandlers(mock as never, deps);
      const handler = getHandler();

      await handler({
        type: "group",
        text: "hi",
        jid: "group@g.us",
        messageId: "m1",
        pushName: "PushAlice",
        rawMessage: {},
        isMentioned: false,
        senderJid: "5555@s.whatsapp.net",
      });

      expect(deps.groupBuffer.append).toHaveBeenCalledWith(
        "group@g.us",
        expect.objectContaining({ senderName: "DB Alice" }),
      );
    });

    it("runs agent on mention with group context", async () => {
      const deps = makeDeps();
      const { mock, getHandler } = createMockWhatsApp();
      wireWhatsAppHandlers(mock as never, deps);
      const handler = getHandler();

      await handler({
        type: "group",
        text: "@bot help",
        jid: "group@g.us",
        messageId: "m1",
        pushName: "Alice",
        rawMessage: {},
        isMentioned: true,
        senderJid: "5555@s.whatsapp.net",
      });
      await flush();

      expect(deps.runAgent).toHaveBeenCalledOnce();
      const agentCall = vi.mocked(deps.runAgent).mock.calls[0][0];
      expect(agentCall.groupContext).toEqual({ groupName: "Test Group", groupDescription: "A test group" });
    });

    it("drains group buffer on mention", async () => {
      const deps = makeDeps();
      vi.mocked(deps.groupBuffer.drain).mockReturnValue([{ senderName: "Bob", text: "earlier msg", timestamp: 1000 }]);
      const { mock, getHandler } = createMockWhatsApp();
      wireWhatsAppHandlers(mock as never, deps);
      const handler = getHandler();

      await handler({
        type: "group",
        text: "@bot help",
        jid: "group@g.us",
        messageId: "m1",
        pushName: "Alice",
        rawMessage: {},
        isMentioned: true,
        senderJid: "5555@s.whatsapp.net",
      });
      await flush();

      expect(deps.groupBuffer.drain).toHaveBeenCalledWith("group@g.us");
      const agentCall = vi.mocked(deps.runAgent).mock.calls[0][0];
      expect(agentCall.userMessage).toContain("Bob");
      expect(agentCall.userMessage).toContain("earlier msg");
    });

    it("starts and stops composing for group mentions", async () => {
      const deps = makeDeps();
      const { mock, getHandler } = createMockWhatsApp();
      wireWhatsAppHandlers(mock as never, deps);
      const handler = getHandler();

      await handler({
        type: "group",
        text: "@bot help",
        jid: "group@g.us",
        messageId: "m1",
        pushName: "Alice",
        rawMessage: {},
        isMentioned: true,
        senderJid: "5555@s.whatsapp.net",
      });
      await flush();

      expect(mock.startComposing).toHaveBeenCalledWith("group@g.us");
      expect(mock.stopComposing).toHaveBeenCalledWith("group@g.us");
    });
  });
});
