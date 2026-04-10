/**
 * Workspace file types and interfaces
 * FileMetadata is defined in @sketch/shared and re-exported here for convenience.
 * WorkspaceService, WorkspaceError, and WorkspaceErrorInfo are server-only.
 */
import type { FileMetadata } from "@sketch/shared";

export type { FileMetadata };

/** Determines which root directory is used: the user's personal workspace or the org-shared directory. */
export type WorkspaceScope = "personal" | "org";

/**
 * Abstraction over workspace filesystem operations.
 * All paths accepted by these methods are relative to the workspace root and validated
 * against path-traversal attacks before any filesystem access occurs.
 */
export interface WorkspaceService {
  listDirectory(userId: string, scope: WorkspaceScope, relativePath: string): Promise<FileMetadata[]>;
  readFile(
    userId: string,
    scope: WorkspaceScope,
    relativePath: string,
  ): Promise<{
    content: Buffer;
    isText: boolean;
    size: number;
    mimeType: string | null;
  }>;
  writeFile(userId: string, scope: WorkspaceScope, relativePath: string, content: string): Promise<void>;
  uploadFile(userId: string, scope: WorkspaceScope, relativePath: string, content: Buffer): Promise<void>;
  createFolder(userId: string, scope: WorkspaceScope, relativePath: string): Promise<void>;
  renameFile(userId: string, scope: WorkspaceScope, oldPath: string, newPath: string): Promise<void>;
  deleteFile(userId: string, scope: WorkspaceScope, relativePath: string): Promise<void>;
  getWorkspacePath(userId: string, scope: WorkspaceScope): string;
  searchFiles(userId: string, scope: WorkspaceScope, query: string): Promise<FileMetadata[]>;
}

/** Serialisable error payload returned in API responses. */
export interface WorkspaceErrorInfo {
  code: string;
  message: string;
}

/** Typed error thrown by workspace service methods; carries an HTTP status code for route handlers. */
export class WorkspaceError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = "WorkspaceError";
  }
}
