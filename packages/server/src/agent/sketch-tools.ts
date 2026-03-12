/**
 * Sketch MCP tools: SendFileToChat (file upload) and getProviderConfig (integration credentials).
 *
 * Uses createSdkMcpServer() for in-memory tool dispatch. UploadCollector is created
 * per agent run. getProviderConfig reads integration provider credentials from the DB
 * so skills can use org-level API keys instead of per-user keys.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";

export class UploadCollector {
  private pending: string[] = [];

  collect(filePath: string): void {
    this.pending.push(filePath);
  }

  drain(): string[] {
    const files = [...this.pending];
    this.pending = [];
    return files;
  }
}

export interface SketchMcpDeps {
  uploadCollector: UploadCollector;
  workspaceDir: string;
  findIntegrationProvider?: () => Promise<{ type: string; credentials: string } | null>;
}

export function createSketchMcpServer(deps: SketchMcpDeps) {
  const absWorkspace = resolve(deps.workspaceDir);

  const tools = [
    tool(
      "SendFileToChat",
      "Queue a file from the workspace to be sent back to the user in chat. The file must exist within your workspace directory. Create the file first using Write or Bash, then call this tool with the absolute path.",
      { file_path: z.string().describe("Absolute path to the file within your workspace") },
      async ({ file_path }) => {
        const absPath = resolve(file_path);

        if (!absPath.startsWith(absWorkspace)) {
          return {
            content: [{ type: "text" as const, text: `Error: file must be within your workspace ${absWorkspace}` }],
          };
        }

        if (!existsSync(absPath)) {
          return {
            content: [{ type: "text" as const, text: `Error: file not found at ${absPath}` }],
          };
        }

        deps.uploadCollector.collect(absPath);
        return {
          content: [{ type: "text" as const, text: `File queued for upload: ${absPath}` }],
        };
      },
    ),

    tool(
      "getProviderConfig",
      "Get the configured integration provider credentials (API key and type). Call this once when you need to use a provider-backed skill like Canvas. Returns null if no provider is configured.",
      {},
      async () => {
        if (!deps.findIntegrationProvider) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ configured: false }) }],
          };
        }

        const provider = await deps.findIntegrationProvider();
        if (!provider) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ configured: false }) }],
          };
        }

        try {
          const parsed = JSON.parse(provider.credentials) as Record<string, string>;
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  configured: true,
                  type: provider.type,
                  apiKey: parsed.apiKey,
                }),
              },
            ],
          };
        } catch {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ configured: false }) }],
          };
        }
      },
    ),
  ];

  return createSdkMcpServer({ name: "sketch", tools });
}
