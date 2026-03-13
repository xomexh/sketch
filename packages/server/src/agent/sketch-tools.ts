/**
 * Sketch MCP tools: SendFileToChat (file upload), getProviderConfig (integration credentials),
 * and ManageScheduledTasks (create/list/update/pause/resume/remove scheduled agent runs).
 *
 * Uses createSdkMcpServer() for in-memory tool dispatch. UploadCollector is created
 * per agent run. getProviderConfig reads integration provider credentials from the DB
 * so skills can use org-level API keys instead of per-user keys.
 *
 * ManageScheduledTasks is always registered (so the agent sees it) but returns an error
 * when scheduler or taskContext are not available (e.g. during scheduled task execution itself,
 * to prevent recursive scheduling).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import type { TaskScheduler } from "../scheduler/service";
import type { TaskContext } from "../scheduler/types";

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
  taskContext?: TaskContext;
  scheduler?: TaskScheduler;
}

const manageScheduledTasksSchema = {
  action: z.enum(["list", "add", "update", "remove", "pause", "resume"]).describe(
    `Action to perform.
- 'add': create a new task (requires prompt, schedule_type, schedule_value)
- 'list': list tasks in this context (no other params needed)
- 'update': modify a task (requires task_id, plus fields to change)
- 'remove': delete a task (requires task_id)
- 'pause': pause a task (requires task_id)
- 'resume': resume a paused task (requires task_id)`,
  ),
  prompt: z
    .string()
    .optional()
    .describe("The instruction the agent executes each run. Be specific and self-contained."),
  schedule_type: z
    .enum(["cron", "interval", "once"])
    .optional()
    .describe("'cron' for cron expressions, 'interval' for fixed second intervals, 'once' for a one-time run."),
  schedule_value: z
    .string()
    .optional()
    .describe(
      `For cron: standard 5-field expression (minute hour day-of-month month day-of-week). Always use 5-field, never 6-field. Examples: '*/2 * * * *' (every 2 min), '0 9 * * 1-5' (weekdays 9am), '0 */6 * * *' (every 6 hours).
For interval: number of seconds as a plain string, minimum 60. Examples: '120' (every 2 min), '3600' (every hour). Do not use duration strings like '2m' or '1h'.
For once: ISO 8601 datetime string (e.g. '2026-03-14T15:00:00'). The task runs once at this time then auto-completes.`,
    ),
  timezone: z.string().optional().describe("IANA timezone (e.g. 'America/New_York', 'Asia/Kolkata'). Defaults to UTC."),
  session_mode: z
    .enum(["fresh", "persistent", "chat"])
    .optional()
    .describe(
      `Controls memory across runs. Usually omit this (smart defaults apply).
- 'fresh': no memory, each run starts clean
- 'persistent': task remembers its own previous runs, isolated from user chat
- 'chat': continues the user's conversation session`,
    ),
  task_id: z.string().optional().describe("ID of the task. Required for update/remove/pause/resume."),
};

type ManageScheduledTasksParams = {
  action: "list" | "add" | "update" | "remove" | "pause" | "resume";
  prompt?: string;
  schedule_type?: "cron" | "interval" | "once";
  schedule_value?: string;
  timezone?: string;
  session_mode?: "fresh" | "persistent" | "chat";
  task_id?: string;
};

export async function handleManageScheduledTasks(
  params: ManageScheduledTasksParams,
  deps: { scheduler: TaskScheduler; taskContext: TaskContext },
): Promise<{ content: { type: "text"; text: string }[] }> {
  const { action, task_id } = params;
  const ctx = deps.taskContext;

  const text = (msg: string) => ({ content: [{ type: "text" as const, text: msg }] });

  switch (action) {
    case "list": {
      const tasks =
        ctx.contextType === "dm"
          ? await deps.scheduler.listTasks({ createdBy: ctx.createdBy })
          : await deps.scheduler.listTasks({ deliveryTarget: ctx.deliveryTarget });
      return text(JSON.stringify(tasks, null, 2));
    }

    case "add": {
      if (!params.prompt || !params.schedule_type || !params.schedule_value) {
        return text("Error: prompt, schedule_type, and schedule_value are required for add action.");
      }

      if (params.schedule_type === "interval") {
        const seconds = Number(params.schedule_value);
        if (!Number.isFinite(seconds) || seconds < 60) {
          return text(
            "Error: interval schedule_value must be a number of seconds (at least 60). Example: '120' for every 2 minutes.",
          );
        }
      }

      if (params.schedule_type === "once") {
        const runAt = new Date(params.schedule_value);
        if (Number.isNaN(runAt.getTime())) {
          return text(
            "Error: once schedule_value must be a valid ISO 8601 datetime string (e.g. '2026-03-14T15:00:00').",
          );
        }
        if (runAt.getTime() <= Date.now()) {
          return text("Error: once schedule_value must be a future datetime. The provided time is in the past.");
        }
      }

      let sessionMode = params.session_mode;
      if (!sessionMode) {
        if (ctx.contextType === "dm") {
          sessionMode = "chat";
        } else if (ctx.contextType === "channel" && ctx.threadTs) {
          sessionMode = "chat";
        } else {
          sessionMode = "fresh";
        }
      }

      if (sessionMode === "chat" && ctx.contextType === "channel" && !ctx.threadTs) {
        return text(
          "Error: 'chat' session mode is not available for top-level channel messages (no thread to continue). Use 'fresh' or 'persistent' instead.",
        );
      }

      const task = await deps.scheduler.addTask({
        platform: ctx.platform,
        contextType: ctx.contextType,
        deliveryTarget: ctx.deliveryTarget,
        threadTs: ctx.threadTs ?? null,
        prompt: params.prompt,
        scheduleType: params.schedule_type,
        scheduleValue: params.schedule_value,
        timezone: params.timezone,
        sessionMode,
        createdBy: ctx.createdBy,
      });

      return text(`Task created:\n${JSON.stringify(task, null, 2)}`);
    }

    case "update": {
      if (!task_id) {
        return text("Error: task_id is required for update action.");
      }
      const updated = await deps.scheduler.updateTask(task_id, {
        prompt: params.prompt,
        scheduleType: params.schedule_type,
        scheduleValue: params.schedule_value,
        timezone: params.timezone,
        sessionMode: params.session_mode,
      });
      if (!updated) {
        return text(`Error: task ${task_id} not found.`);
      }
      return text(`Task updated:\n${JSON.stringify(updated, null, 2)}`);
    }

    case "remove": {
      if (!task_id) {
        return text("Error: task_id is required for remove action.");
      }
      const removed = await deps.scheduler.removeTask(task_id);
      if (!removed) {
        return text(`Error: task ${task_id} not found.`);
      }
      return text(`Task ${task_id} removed.`);
    }

    case "pause": {
      if (!task_id) {
        return text("Error: task_id is required for pause action.");
      }
      await deps.scheduler.pauseTask(task_id);
      return text(`Task ${task_id} paused.`);
    }

    case "resume": {
      if (!task_id) {
        return text("Error: task_id is required for resume action.");
      }
      await deps.scheduler.resumeTask(task_id);
      return text(`Task ${task_id} resumed.`);
    }
  }
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

    tool(
      "ManageScheduledTasks",
      "Manage scheduled tasks that run automatically. Platform, delivery target, and creator are filled in automatically from context. Do not ask the user for these.",
      manageScheduledTasksSchema,
      async (params) => {
        if (!deps.scheduler || !deps.taskContext) {
          return { content: [{ type: "text" as const, text: "Scheduled tasks are not available in this context." }] };
        }
        return handleManageScheduledTasks(params, { scheduler: deps.scheduler, taskContext: deps.taskContext });
      },
    ),
  ];

  return createSdkMcpServer({ name: "sketch", tools });
}
