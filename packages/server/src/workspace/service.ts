/**
 * Workspace file operations service — file browsing, reading, writing, and management.
 *
 * Editability is determined from the file extension via {@link getMimeType} without reading file
 * contents. A file is editable if its MIME type starts with "text/" or is one of the known
 * plaintext "application/" subtypes (JSON, JS, TS, XML, YAML, SQL, shell).
 */
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, sep } from "node:path";
import { ensureWorkspace } from "../agent/workspace";
import type { Config } from "../config";
import {
  type FileMetadata,
  type WorkspaceService as IWorkspaceService,
  WorkspaceError,
  type WorkspaceScope,
} from "./types";
import { isWorkspaceRoot, resolveAndValidatePath, validateFileName, validatePath } from "./validation";

const ONE_MB = 1024 * 1024;
/** Maximum file size (1 MB) for text editing — larger files are served as downloads only. */
const MAX_EDITABLE_SIZE = ONE_MB;

const EDITABLE_APPLICATION_MIME_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/yaml",
  "application/sql",
  "application/x-sh",
  "application/powershell",
]);

/**
 * Determines whether a file is editable (i.e. human-readable text) based on its MIME type.
 * MIME types starting with "text/" are always editable; additionally we allow certain
 * "application/" subtypes that are plaintext in practice (JSON, JS, TS, XML, YAML, SQL, shell).
 */
function isEditableMimeType(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith("text/") || EDITABLE_APPLICATION_MIME_TYPES.has(mimeType);
}

/**
 * Returns (and creates if absent) the filesystem root for the given scope.
 * Org scope maps to `CLAUDE_CONFIG_DIR`; user scope maps to `DATA_DIR/workspaces/{userId}`.
 */
export async function resolveWorkspaceRoot(config: Config, userId: string, scope: WorkspaceScope): Promise<string> {
  if (scope === "org") {
    await mkdir(config.CLAUDE_CONFIG_DIR, { recursive: true });
    return config.CLAUDE_CONFIG_DIR;
  }
  return ensureWorkspace(config, userId);
}

/**
 * Creates a {@link IWorkspaceService} that scopes all filesystem operations to
 * a per-user (or org-shared) workspace directory. Path validation and traversal
 * prevention are handled by the validation module; this layer handles the
 * business rules around editability, size limits, and stat-based existence checks.
 */
export function createWorkspaceService(config: Config): IWorkspaceService {
  return {
    /** Returns the absolute workspace root path without creating it. */
    getWorkspacePath(userId: string, scope: WorkspaceScope): string {
      if (scope === "org") {
        return config.CLAUDE_CONFIG_DIR;
      }
      return join(config.DATA_DIR, "workspaces", userId);
    },

    /**
     * Lists directory contents at `relativePath` within the user's workspace.
     * Entries that cannot be stat'd (broken symlinks, permission errors) are silently skipped.
     */
    async listDirectory(userId: string, scope: WorkspaceScope, relativePath: string): Promise<FileMetadata[]> {
      const workspaceRoot = await resolveWorkspaceRoot(config, userId, scope);

      const validation = await validatePath(workspaceRoot, relativePath);
      if (!validation.valid) {
        throw new WorkspaceError("INVALID_PATH", validation.error ?? "Invalid path", 400);
      }

      const targetPath = validation.resolvedPath;
      if (!targetPath) {
        throw new WorkspaceError("INVALID_PATH", "Could not resolve path", 400);
      }

      let stats: ReturnType<typeof stat> extends Promise<infer T> ? T : never;
      try {
        stats = await stat(targetPath);
      } catch {
        throw new WorkspaceError("NOT_FOUND", "Directory not found", 404);
      }

      if (!stats.isDirectory()) {
        throw new WorkspaceError("NOT_DIRECTORY", "Path is not a directory", 400);
      }

      const entries = await readdir(targetPath, { withFileTypes: true });

      const files: FileMetadata[] = [];

      for (const entry of entries) {
        const entryPath = join(relativePath, entry.name);
        const fullPath = join(targetPath, entry.name);

        let entryStats: ReturnType<typeof stat> extends Promise<infer T> ? T : never;
        try {
          entryStats = await stat(fullPath);
        } catch {
          continue;
        }

        const isDirectory = entryStats.isDirectory();
        let isEditable = false;
        let mimeType: string | null = null;

        if (!isDirectory) {
          mimeType = getMimeType(entry.name);
          isEditable = entryStats.size <= MAX_EDITABLE_SIZE && isEditableMimeType(mimeType);
        }

        files.push({
          name: entry.name,
          path: entryPath,
          size: entryStats.size,
          modifiedAt: entryStats.mtime.toISOString(),
          isDirectory,
          isEditable,
          mimeType,
        });
      }

      files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      return files;
    },

    /**
     * Reads a file and returns its content as a Buffer along with metadata.
     * `isText` reflects whether the MIME type is editable — callers use this to decide
     * whether to serve JSON or stream a binary download.
     */
    async readFile(
      userId: string,
      scope: WorkspaceScope,
      relativePath: string,
    ): Promise<{ content: Buffer; isText: boolean; size: number; mimeType: string | null }> {
      const workspaceRoot = await resolveWorkspaceRoot(config, userId, scope);

      const validation = await resolveAndValidatePath(workspaceRoot, relativePath);
      if (!validation.valid) {
        throw new WorkspaceError("INVALID_PATH", validation.error ?? "Invalid path", 400);
      }

      const targetPath = validation.resolvedPath;
      if (!targetPath) {
        throw new WorkspaceError("INVALID_PATH", "Could not resolve path", 400);
      }

      let stats: ReturnType<typeof stat> extends Promise<infer T> ? T : never;
      try {
        stats = await stat(targetPath);
      } catch {
        throw new WorkspaceError("NOT_FOUND", "File not found", 404);
      }

      if (stats.isDirectory()) {
        throw new WorkspaceError("IS_DIRECTORY", "Cannot read directory as file", 400);
      }

      const content = await readFile(targetPath);
      const mimeType = getMimeType(relativePath);
      const isText = isEditableMimeType(mimeType);

      return { content, isText, size: stats.size, mimeType };
    },

    /**
     * Writes a text file, creating parent directories as needed.
     * Rejects binary files, files exceeding 1 MB, and invalid filenames.
     * Writing to a path that does not yet exist creates the file.
     */
    async writeFile(userId: string, scope: WorkspaceScope, relativePath: string, content: string): Promise<void> {
      const workspaceRoot = await resolveWorkspaceRoot(config, userId, scope);

      const validation = await resolveAndValidatePath(workspaceRoot, relativePath);
      if (!validation.valid) {
        throw new WorkspaceError("INVALID_PATH", validation.error ?? "Invalid path", 400);
      }

      const targetPath = validation.resolvedPath;
      if (!targetPath) {
        throw new WorkspaceError("INVALID_PATH", "Could not resolve path", 400);
      }

      try {
        const stats = await stat(targetPath);
        if (stats.isDirectory()) {
          throw new WorkspaceError("IS_DIRECTORY", "Cannot write to a directory", 400);
        }

        const mimeType = getMimeType(relativePath);
        if (!isEditableMimeType(mimeType)) {
          throw new WorkspaceError("NOT_TEXT_FILE", "Cannot edit binary files", 415);
        }

        if (stats.size > MAX_EDITABLE_SIZE) {
          throw new WorkspaceError("FILE_TOO_LARGE", "File too large to edit (max 1MB)", 413);
        }
      } catch (err) {
        if (err instanceof WorkspaceError) throw err;
      }

      const pathParts = relativePath.split(sep);
      const fileName = pathParts[pathParts.length - 1] ?? "";
      const nameValidation = validateFileName(fileName);
      if (!nameValidation.valid) {
        throw new WorkspaceError("INVALID_NAME", nameValidation.error ?? "Invalid filename", 400);
      }

      const parentDir = dirname(targetPath);
      await mkdir(parentDir, { recursive: true });

      await writeFile(targetPath, content, "utf-8");
    },

    /**
     * Uploads a binary file, creating parent directories as needed.
     * Size limit is `MAX_UPLOAD_SIZE_MB` from config (default 50 MB).
     */
    async uploadFile(userId: string, scope: WorkspaceScope, relativePath: string, content: Buffer): Promise<void> {
      const workspaceRoot = await resolveWorkspaceRoot(config, userId, scope);

      const maxUploadSize = (config as Config & { MAX_UPLOAD_SIZE_MB?: number }).MAX_UPLOAD_SIZE_MB ?? 50;
      const maxSize = maxUploadSize * 1024 * 1024;
      if (content.length > maxSize) {
        throw new WorkspaceError("FILE_TOO_LARGE", `File exceeds maximum size of ${maxUploadSize}MB`, 413);
      }

      const validation = await validatePath(workspaceRoot, relativePath);
      if (!validation.valid) {
        throw new WorkspaceError("INVALID_PATH", validation.error ?? "Invalid path", 400);
      }

      const targetPath = validation.resolvedPath;
      if (!targetPath) {
        throw new WorkspaceError("INVALID_PATH", "Could not resolve path", 400);
      }

      const pathParts = relativePath.split(sep);
      const fileName = pathParts[pathParts.length - 1] ?? "";
      const nameValidation = validateFileName(fileName);
      if (!nameValidation.valid) {
        throw new WorkspaceError("INVALID_NAME", nameValidation.error ?? "Invalid filename", 400);
      }

      const parentDir = dirname(targetPath);
      await mkdir(parentDir, { recursive: true });

      await writeFile(targetPath, content);
    },

    /**
     * Creates a folder at `relativePath`, including any missing ancestors.
     * Validates every path segment name and rejects paths that already exist.
     */
    async createFolder(userId: string, scope: WorkspaceScope, relativePath: string): Promise<void> {
      const workspaceRoot = await resolveWorkspaceRoot(config, userId, scope);

      const validation = await validatePath(workspaceRoot, relativePath);
      if (!validation.valid) {
        throw new WorkspaceError("INVALID_PATH", validation.error ?? "Invalid path", 400);
      }

      const targetPath = validation.resolvedPath;
      if (!targetPath) {
        throw new WorkspaceError("INVALID_PATH", "Could not resolve path", 400);
      }

      const parts = relativePath.split(sep).filter((p) => p && p !== ".");
      for (const part of parts) {
        const nameValidation = validateFileName(part);
        if (!nameValidation.valid) {
          throw new WorkspaceError("INVALID_NAME", nameValidation.error ?? "Invalid folder name", 400);
        }
      }

      try {
        const stats = await stat(targetPath);
        if (stats.isDirectory()) {
          throw new WorkspaceError("ALREADY_EXISTS", "Folder already exists", 409);
        }
        throw new WorkspaceError("FILE_EXISTS", "A file with that name already exists", 409);
      } catch (err) {
        if (err instanceof WorkspaceError) throw err;
      }

      await mkdir(targetPath, { recursive: true });
    },

    /**
     * Renames or moves a file or folder. The source must exist; the destination must not.
     * Parent directories of the destination are created automatically.
     */
    async renameFile(userId: string, scope: WorkspaceScope, oldPath: string, newPath: string): Promise<void> {
      const workspaceRoot = await resolveWorkspaceRoot(config, userId, scope);

      const oldValidation = await resolveAndValidatePath(workspaceRoot, oldPath);
      if (!oldValidation.valid) {
        throw new WorkspaceError("INVALID_PATH", `Old path: ${oldValidation.error ?? "Invalid"}`, 400);
      }

      const newValidation = await validatePath(workspaceRoot, newPath);
      if (!newValidation.valid) {
        throw new WorkspaceError("INVALID_PATH", `New path: ${newValidation.error ?? "Invalid"}`, 400);
      }

      const oldFullPath = oldValidation.resolvedPath;
      const newFullPath = newValidation.resolvedPath;
      if (!oldFullPath || !newFullPath) {
        throw new WorkspaceError("INVALID_PATH", "Could not resolve path", 400);
      }

      try {
        await stat(oldFullPath);
      } catch {
        throw new WorkspaceError("NOT_FOUND", "Source file not found", 404);
      }

      const newPathParts = newPath.split(sep);
      const newFileName = newPathParts[newPathParts.length - 1] ?? "";
      const nameValidation = validateFileName(newFileName);
      if (!nameValidation.valid) {
        throw new WorkspaceError("INVALID_NAME", nameValidation.error ?? "Invalid filename", 400);
      }

      try {
        await stat(newFullPath);
        throw new WorkspaceError("ALREADY_EXISTS", "A file with that name already exists", 409);
      } catch (err) {
        if (err instanceof WorkspaceError) throw err;
      }

      const parentDir = dirname(newFullPath);
      await mkdir(parentDir, { recursive: true });

      await rename(oldFullPath, newFullPath);
    },

    /** Deletes a file or folder recursively. Refuses to delete the workspace root itself. */
    async deleteFile(userId: string, scope: WorkspaceScope, relativePath: string): Promise<void> {
      const workspaceRoot = await resolveWorkspaceRoot(config, userId, scope);

      if (isWorkspaceRoot(workspaceRoot, relativePath)) {
        throw new WorkspaceError("CANNOT_DELETE_ROOT", "Cannot delete root workspace", 403);
      }

      const validation = await resolveAndValidatePath(workspaceRoot, relativePath);
      if (!validation.valid) {
        throw new WorkspaceError("INVALID_PATH", validation.error ?? "Invalid path", 400);
      }

      const targetPath = validation.resolvedPath;
      if (!targetPath) {
        throw new WorkspaceError("INVALID_PATH", "Could not resolve path", 400);
      }

      try {
        await stat(targetPath);
      } catch {
        throw new WorkspaceError("NOT_FOUND", "File or folder not found", 404);
      }

      await rm(targetPath, { recursive: true, force: true });
    },

    /**
     * Recursively searches for files and folders whose names contain `query` (case-insensitive).
     * Capped at 100 results and 10 levels of directory depth.
     */
    async searchFiles(userId: string, scope: WorkspaceScope, query: string): Promise<FileMetadata[]> {
      const workspaceRoot = await resolveWorkspaceRoot(config, userId, scope);
      const results: FileMetadata[] = [];
      const searchLower = query.toLowerCase();

      async function searchRecursive(currentPath: string, relativePath: string, depth: number) {
        if (depth > 10 || results.length >= 100) return;

        const entries = await readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          if (results.length >= 100) break;

          const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          const fullPath = join(currentPath, entry.name);

          let entryStats: Awaited<ReturnType<typeof stat>>;
          try {
            entryStats = await stat(fullPath);
          } catch {
            continue;
          }

          const isDirectory = entryStats.isDirectory();
          const matchesSearch = entry.name.toLowerCase().includes(searchLower);

          if (matchesSearch) {
            let isEditable = false;
            let mimeType: string | null = null;

            if (!isDirectory) {
              mimeType = getMimeType(entry.name);
              isEditable = entryStats.size <= MAX_EDITABLE_SIZE && isEditableMimeType(mimeType);
            }

            results.push({
              name: entry.name,
              path: entryRelativePath,
              size: entryStats.size,
              modifiedAt: entryStats.mtime.toISOString(),
              isDirectory,
              isEditable,
              mimeType,
            });
          }

          if (isDirectory) {
            await searchRecursive(fullPath, entryRelativePath, depth + 1);
          }
        }
      }

      await searchRecursive(workspaceRoot, "", 0);
      return results;
    },
  };
}

/** Returns the MIME type for a filename based on its extension, or null if unknown. */
function getMimeType(fileName: string): string | null {
  const ext = extname(fileName).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".js": "application/javascript",
    ".ts": "application/typescript",
    ".jsx": "application/javascript",
    ".tsx": "application/typescript",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".scss": "text/scss",
    ".sass": "text/sass",
    ".less": "text/less",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".csv": "text/csv",
    ".py": "text/x-python",
    ".rb": "text/x-ruby",
    ".php": "text/x-php",
    ".java": "text/x-java",
    ".c": "text/x-c",
    ".cpp": "text/x-c++",
    ".h": "text/x-c",
    ".hpp": "text/x-c++",
    ".go": "text/x-go",
    ".rs": "text/x-rust",
    ".swift": "text/x-swift",
    ".kt": "text/x-kotlin",
    ".sql": "application/sql",
    ".sh": "application/x-sh",
    ".bash": "application/x-sh",
    ".zsh": "application/x-sh",
    ".fish": "application/x-sh",
    ".ps1": "application/powershell",
    ".dockerfile": "text/x-dockerfile",
    ".env": "text/plain",
    ".gitignore": "text/plain",
    ".gitattributes": "text/plain",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".bz2": "application/x-bzip2",
    ".xz": "application/x-xz",
    ".7z": "application/x-7z-compressed",
    ".rar": "application/x-rar-compressed",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };

  return mimeTypes[ext] || null;
}
