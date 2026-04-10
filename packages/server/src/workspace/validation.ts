/**
 * Path and filename validation for workspace file operations.
 * Guards against directory traversal attacks and symlink escapes.
 * {@link validateFileName} delegates to `fileNameSchema` from `@sketch/shared`
 * so client and server enforce identical naming rules.
 */
import { realpath } from "node:fs/promises";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import { fileNameSchema } from "@sketch/shared";

/** Result of a workspace path validation check. */
interface ValidationResult {
  valid: boolean;
  error?: string;
  resolvedPath?: string;
}

/**
 * Resolves a path to absolute form and strips any trailing separator,
 * so that prefix-based containment checks (`startsWith(root + sep)`) work correctly
 * regardless of how the path was originally constructed.
 */
function normalizeForComparison(path: string): string {
  const resolved = isAbsolute(path) ? path : resolve(path);
  return resolved.endsWith(sep) ? resolved.slice(0, -1) : resolved;
}

/**
 * Validates that a resolved path stays within the workspace root.
 * Prevents directory traversal attacks like ../../../etc/passwd.
 *
 * The workspace root is resolved via realpath before comparison so that symlinks in DATA_DIR
 * (or any parent directory) cannot be used to bypass the containment check.
 */
export async function validatePath(workspaceRoot: string, relativePath: string): Promise<ValidationResult> {
  if (!relativePath || relativePath.trim() === "") {
    return { valid: false, error: "Path cannot be empty" };
  }

  const realWorkspaceRoot = await realpath(workspaceRoot);

  if (relativePath === "." || relativePath === "./") {
    return { valid: true, resolvedPath: normalizeForComparison(realWorkspaceRoot) };
  }

  if (isAbsolute(relativePath)) {
    return { valid: false, error: "Absolute paths are not allowed" };
  }

  const normalizedRelative = normalize(relativePath);

  const pathParts = normalizedRelative.split(sep).filter((part) => part.length > 0);
  for (const part of pathParts) {
    if (part === "..") {
      return { valid: false, error: "Path traversal detected" };
    }
  }

  const resolvedPath = resolve(realWorkspaceRoot, normalizedRelative);

  const normalizedWorkspaceRoot = normalizeForComparison(realWorkspaceRoot);
  const normalizedResolvedPath = normalizeForComparison(resolvedPath);

  if (
    normalizedResolvedPath !== normalizedWorkspaceRoot &&
    !normalizedResolvedPath.startsWith(normalizedWorkspaceRoot + sep)
  ) {
    return { valid: false, error: "Path is outside workspace" };
  }

  return { valid: true, resolvedPath };
}

/** Result of a filename/folder-name validation check. */
interface FileNameValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a filename/folder name using the shared fileNameSchema from @sketch/shared.
 * Maps zod parse errors to the FileNameValidationResult shape used by callers.
 */
export function validateFileName(name: string): FileNameValidationResult {
  const result = fileNameSchema.safeParse(name);
  if (!result.success) {
    return { valid: false, error: result.error.issues[0]?.message ?? "Invalid name" };
  }
  return { valid: true };
}

/**
 * Like {@link validatePath}, but additionally resolves the target to its real path via `realpath`
 * and re-validates containment, catching symlinks that point outside the workspace.
 * If `realpath` throws (path does not exist yet — valid for create/write operations),
 * the pre-realpath resolved path is returned as-is.
 */
export async function resolveAndValidatePath(workspaceRoot: string, relativePath: string): Promise<ValidationResult> {
  const validation = await validatePath(workspaceRoot, relativePath);
  if (!validation.valid) {
    return validation;
  }

  const resolvedFromValidation = validation.resolvedPath;
  if (!resolvedFromValidation) {
    return { valid: false, error: "Could not resolve path" };
  }

  try {
    const realPath = await realpath(resolvedFromValidation);

    const realRoot = await realpath(workspaceRoot);
    const normalizedWorkspaceRoot = normalizeForComparison(realRoot);
    const normalizedRealPath = normalizeForComparison(realPath);

    if (
      normalizedRealPath !== normalizedWorkspaceRoot &&
      !normalizedRealPath.startsWith(normalizedWorkspaceRoot + sep)
    ) {
      return { valid: false, error: "Symlink points outside workspace" };
    }

    return { valid: true, resolvedPath: realPath };
  } catch {
    return { valid: true, resolvedPath: resolvedFromValidation };
  }
}

/** Returns true if `relativePath` refers to the workspace root itself (empty, `.`, or `./`). */
export function isWorkspaceRoot(workspaceRoot: string, relativePath: string): boolean {
  if (!relativePath || relativePath.trim() === "" || relativePath === "." || relativePath === "./") {
    return true;
  }
  const normalized = normalize(relativePath);
  return normalized === "." || normalized === "" || normalized === "/";
}
