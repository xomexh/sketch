/**
 * TanStack Query hooks for workspace file operations (file browser UI).
 *
 * Queries: directory listing, recursive search, file content. Mutations invalidate
 * affected caches — e.g. after save, content and the parent directory listing;
 * after upload/create/folder ops, the parent listing; after delete, parent listing
 * and content for the path; after rename, both parent directories when they differ
 * and content for the old path.
 */
import { type WorkspaceScope, api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type { WorkspaceScope };

const WORKSPACE_QUERY_KEY = "workspace";
const WORKSPACE_FILES_KEY = "workspace-files";

interface FileContent {
  content: string;
  isText: boolean;
  size: number;
  mimeType: string | null;
}

export function useFiles(scope: WorkspaceScope, path: string) {
  return useQuery({
    queryKey: [WORKSPACE_QUERY_KEY, WORKSPACE_FILES_KEY, scope, path],
    queryFn: () => api.workspace.listFiles(scope, path),
    enabled: path !== undefined,
  });
}

export function useSearchFiles(scope: WorkspaceScope, query: string) {
  return useQuery({
    queryKey: [WORKSPACE_QUERY_KEY, "search", scope, query],
    queryFn: () => api.workspace.searchFiles(scope, query),
    enabled: query !== undefined && query.trim().length > 0,
  });
}

export function useFileContent(scope: WorkspaceScope, path: string | null) {
  return useQuery({
    queryKey: [WORKSPACE_QUERY_KEY, "content", scope, path],
    queryFn: async (): Promise<FileContent | null> => {
      if (!path) return null;
      return api.workspace.getFileContent(scope, path);
    },
    enabled: !!path,
  });
}

export function useSaveFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { scope: WorkspaceScope; path: string; content: string }) => {
      return api.workspace.saveFile(params.scope, params.path, params.content);
    },
    onSuccess: (_, { scope, path }) => {
      queryClient.invalidateQueries({ queryKey: [WORKSPACE_QUERY_KEY, "content", scope, path] });
      const parentPath = path.split("/").slice(0, -1).join("/") || ".";
      queryClient.invalidateQueries({ queryKey: [WORKSPACE_QUERY_KEY, WORKSPACE_FILES_KEY, scope, parentPath] });
    },
  });
}

export function useUploadFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { scope: WorkspaceScope; path: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", params.file);
      return api.workspace.uploadFile(params.scope, params.path, formData);
    },
    onSuccess: (_, { scope, path }) => {
      const parentPath = path.split("/").slice(0, -1).join("/") || ".";
      queryClient.invalidateQueries({ queryKey: [WORKSPACE_QUERY_KEY, WORKSPACE_FILES_KEY, scope, parentPath] });
    },
  });
}

export function useCreateFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { scope: WorkspaceScope; path: string }) => {
      return api.workspace.createFolder(params.scope, params.path);
    },
    onSuccess: (_, { scope, path }) => {
      const parentPath = path.split("/").slice(0, -1).join("/") || ".";
      queryClient.invalidateQueries({ queryKey: [WORKSPACE_QUERY_KEY, WORKSPACE_FILES_KEY, scope, parentPath] });
    },
  });
}

export function useCreateFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { scope: WorkspaceScope; path: string }) => {
      return api.workspace.createFile(params.scope, params.path);
    },
    onSuccess: (_, { scope, path }) => {
      const parentPath = path.split("/").slice(0, -1).join("/") || ".";
      queryClient.invalidateQueries({ queryKey: [WORKSPACE_QUERY_KEY, WORKSPACE_FILES_KEY, scope, parentPath] });
    },
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { scope: WorkspaceScope; path: string }) => {
      return api.workspace.deleteFile(params.scope, params.path);
    },
    onSuccess: (_, { scope, path }) => {
      const parentPath = path.split("/").slice(0, -1).join("/") || ".";
      queryClient.invalidateQueries({ queryKey: [WORKSPACE_QUERY_KEY, WORKSPACE_FILES_KEY, scope, parentPath] });
      queryClient.invalidateQueries({ queryKey: [WORKSPACE_QUERY_KEY, "content", scope, path] });
    },
  });
}

export function useRenameFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { scope: WorkspaceScope; oldPath: string; newPath: string }) => {
      return api.workspace.renameFile(params.scope, params.oldPath, params.newPath);
    },
    onSuccess: (_, { scope, oldPath, newPath }) => {
      const oldParent = oldPath.split("/").slice(0, -1).join("/") || ".";
      const newParent = newPath.split("/").slice(0, -1).join("/") || ".";
      queryClient.invalidateQueries({ queryKey: [WORKSPACE_QUERY_KEY, WORKSPACE_FILES_KEY, scope, oldParent] });
      if (oldParent !== newParent) {
        queryClient.invalidateQueries({ queryKey: [WORKSPACE_QUERY_KEY, WORKSPACE_FILES_KEY, scope, newParent] });
      }
      queryClient.invalidateQueries({ queryKey: [WORKSPACE_QUERY_KEY, "content", scope, oldPath] });
    },
  });
}
