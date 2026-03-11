/**
 * Tests for the provider factory and MCP config builder.
 * Validates that createProvider instantiates the correct adapter,
 * buildMcpConfig produces correct HTTP config for both integration
 * providers and plain MCP servers.
 */
import { describe, expect, it } from "vitest";
import { CanvasProvider } from "./canvas";
import { buildMcpConfig, createProvider } from "./factory";

const validCanvasCreds = JSON.stringify({ apiKey: "sk-test-key" });

describe("createProvider()", () => {
  it("returns a CanvasProvider for type canvas", () => {
    const provider = createProvider("canvas", "https://canvas.example.com", validCanvasCreds, "provider-1");
    expect(provider).toBeInstanceOf(CanvasProvider);
  });

  it("throws for unimplemented type", () => {
    const creds = JSON.stringify({ apiKey: "key" });
    expect(() => createProvider("composio", "https://composio.example.com", creds, "provider-2")).toThrow(
      "not yet implemented",
    );
  });

  it("throws on invalid credentials (missing apiKey)", () => {
    const badCreds = JSON.stringify({});
    expect(() => createProvider("canvas", "https://canvas.example.com", badCreds, "provider-4")).toThrow();
  });

  it("throws on invalid JSON", () => {
    expect(() => createProvider("canvas", "https://canvas.example.com", "not-json", "provider-6")).toThrow();
  });
});

describe("buildMcpConfig()", () => {
  it("returns correct HTTP config for integration provider with user email", () => {
    const config = buildMcpConfig("https://canvas.example.com/mcp", validCanvasCreds, "user@test.com", "canvas");
    expect(config).toEqual({
      type: "http",
      url: "https://canvas.example.com/mcp",
      headers: {
        Authorization: "Bearer sk-test-key",
        "X-User-Email": "user@test.com",
      },
    });
  });

  it("returns correct HTTP config for plain MCP with bearer token", () => {
    const creds = JSON.stringify({ bearerToken: "tok-abc" });
    const config = buildMcpConfig("https://mcp.example.com", creds, "user@test.com", null);
    expect(config).toEqual({
      type: "http",
      url: "https://mcp.example.com",
      headers: {
        Authorization: "Bearer tok-abc",
      },
    });
  });

  it("returns config without auth header when no credentials token", () => {
    const creds = JSON.stringify({});
    const config = buildMcpConfig("https://mcp.example.com", creds, null, null);
    expect(config).toEqual({
      type: "http",
      url: "https://mcp.example.com",
      headers: {},
    });
  });

  it("throws on invalid JSON", () => {
    expect(() => buildMcpConfig("https://mcp.example.com", "{bad", "user@test.com", null)).toThrow();
  });
});
