/**
 * Hono route handlers for `/api/workspace/*` — file and folder CRUD within a user's isolated workspace.
 */
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import type { Config } from "../config";
import { createWorkspaceService } from "./service";
import { WorkspaceError, type WorkspaceScope } from "./types";
import { isWorkspaceRoot } from "./validation";

/** Dependencies injected into the workspace route factory. */
interface WorkspaceRouteDeps {
  config: Config;
}

const pathQuerySchema = z.object({
  path: z.string().default(""),
});

const fileContentSchema = z.object({
  content: z.string(),
});

const renameSchema = z.object({
  oldPath: z.string().min(1, "Old path is required"),
  newPath: z.string().min(1, "New path is required"),
});

const folderSchema = z.object({
  path: z.string().min(1, "Path is required"),
});

const scopeSchema = z.enum(["personal", "org"]).default("personal");

/** Maps a WorkspaceError (or generic Error) to the JSON error shape returned by route handlers. */
function errorResponse(error: WorkspaceError | Error) {
  if (error instanceof WorkspaceError) {
    return {
      error: {
        code: error.code,
        message: error.message,
      },
    };
  }
  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  };
}

/** Registers all `/api/workspace/*` routes onto a Hono router and returns it. */
export function workspaceRoutes(deps: WorkspaceRouteDeps) {
  const routes = new Hono();
  const service = createWorkspaceService(deps.config);

  /** List directory contents at the given path (defaults to workspace root). */
  routes.get("/files", async (c) => {
    const userId = c.get("sub");
    const scope = scopeSchema.parse(c.req.query("scope") ?? "personal");
    const query = c.req.query();
    const parsed = pathQuerySchema.safeParse(query);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request";
      return c.json({ error: { code: "VALIDATION_ERROR", message } }, 400);
    }

    try {
      const path = parsed.data.path || ".";
      const files = await service.listDirectory(userId, scope, path);
      return c.json({ files });
    } catch (err) {
      if (err instanceof WorkspaceError) {
        return c.json(errorResponse(err), err.statusCode as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

  /** Full-text search across workspace files. Requires a non-empty `q` query param. */
  routes.get("/files/search", async (c) => {
    const userId = c.get("sub");
    const scope = scopeSchema.parse(c.req.query("scope") ?? "personal");
    const query = c.req.query("q");

    if (!query || query.trim() === "") {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Search query is required" } }, 400);
    }

    try {
      const files = await service.searchFiles(userId, scope, query.trim());
      return c.json({ files });
    } catch (err) {
      if (err instanceof WorkspaceError) {
        return c.json(errorResponse(err), err.statusCode as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

  /** Read a file. Text files are returned as JSON; binary files (or `?download=true`) are streamed as an attachment. */
  routes.get("/files/content", async (c) => {
    const userId = c.get("sub");
    const scope = scopeSchema.parse(c.req.query("scope") ?? "personal");
    const query = c.req.query();
    const parsed = pathQuerySchema.safeParse(query);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request";
      return c.json({ error: { code: "VALIDATION_ERROR", message } }, 400);
    }

    if (!parsed.data.path) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Path is required" } }, 400);
    }

    try {
      const result = await service.readFile(userId, scope, parsed.data.path);
      const forceDownload = query.download === "true";

      if (result.isText && !forceDownload) {
        const content = result.content.toString("utf-8");
        return c.json({
          content,
          isText: true,
          size: result.size,
          mimeType: result.mimeType,
        });
      }

      const filename = parsed.data.path.split("/").pop() || "download";
      c.header("Content-Type", result.mimeType || "application/octet-stream");
      c.header("Content-Disposition", `attachment; filename="${filename}"`);
      return c.body(result.content as unknown as ReadableStream);
    } catch (err) {
      if (err instanceof WorkspaceError) {
        return c.json(errorResponse(err), err.statusCode as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

  /** Write (create or overwrite) a text file at the given path. */
  routes.put("/files/content", async (c) => {
    const userId = c.get("sub");
    const scope = scopeSchema.parse(c.req.query("scope") ?? "personal");
    const query = c.req.query();
    const parsedQuery = pathQuerySchema.safeParse(query);

    if (!parsedQuery.success || !parsedQuery.data.path) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Path is required" } }, 400);
    }

    const body = await c.req.json();
    const parsedBody = fileContentSchema.safeParse(body);

    if (!parsedBody.success) {
      const message = parsedBody.error.issues[0]?.message ?? "Invalid request";
      return c.json({ error: { code: "VALIDATION_ERROR", message } }, 400);
    }

    try {
      await service.writeFile(userId, scope, parsedQuery.data.path, parsedBody.data.content);
      return c.json({ success: true });
    } catch (err) {
      if (err instanceof WorkspaceError) {
        return c.json(errorResponse(err), err.statusCode as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

  /** Upload a binary file via multipart form-data (`file` field). */
  routes.post("/files", async (c) => {
    const userId = c.get("sub");
    const scope = scopeSchema.parse(c.req.query("scope") ?? "personal");
    const query = c.req.query();
    const parsedQuery = pathQuerySchema.safeParse(query);

    if (!parsedQuery.success || !parsedQuery.data.path) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Path is required" } }, 400);
    }

    const body = await c.req.parseBody();
    const file = body.file;

    if (!file) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "No file provided" } }, 400);
    }

    if (typeof file === "string") {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Invalid file upload" } }, 400);
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      await service.uploadFile(userId, scope, parsedQuery.data.path, buffer);
      return c.json({ success: true }, 201);
    } catch (err) {
      if (err instanceof WorkspaceError) {
        return c.json(errorResponse(err), err.statusCode as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

  /** Create a folder (and any missing parent directories) at the given path. */
  routes.post("/folders", async (c) => {
    const userId = c.get("sub");
    const scope = scopeSchema.parse(c.req.query("scope") ?? "personal");
    const body = await c.req.json();
    const parsed = folderSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request";
      return c.json({ error: { code: "VALIDATION_ERROR", message } }, 400);
    }

    try {
      await service.createFolder(userId, scope, parsed.data.path);
      return c.json({ success: true }, 201);
    } catch (err) {
      if (err instanceof WorkspaceError) {
        return c.json(errorResponse(err), err.statusCode as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

  /** Rename or move a file or folder within the workspace. */
  routes.patch("/files/rename", async (c) => {
    const userId = c.get("sub");
    const scope = scopeSchema.parse(c.req.query("scope") ?? "personal");
    const body = await c.req.json();
    const parsed = renameSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid request";
      return c.json({ error: { code: "VALIDATION_ERROR", message } }, 400);
    }

    try {
      await service.renameFile(userId, scope, parsed.data.oldPath, parsed.data.newPath);
      return c.json({ success: true });
    } catch (err) {
      if (err instanceof WorkspaceError) {
        return c.json(errorResponse(err), err.statusCode as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

  /** Delete a file or folder (recursively) at the given path. */
  routes.delete("/files", async (c) => {
    const userId = c.get("sub");
    const scope = scopeSchema.parse(c.req.query("scope") ?? "personal");
    const query = c.req.query();
    const parsed = pathQuerySchema.safeParse(query);

    if (!parsed.success || !parsed.data.path) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "Path is required" } }, 400);
    }

    try {
      await service.deleteFile(userId, scope, parsed.data.path);
      return c.json({ success: true });
    } catch (err) {
      if (err instanceof WorkspaceError) {
        return c.json(errorResponse(err), err.statusCode as Parameters<typeof c.json>[1]);
      }
      throw err;
    }
  });

  return routes;
}
