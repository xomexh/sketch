/**
 * Tests for the Google Drive connector.
 *
 * Security: folderId injection guard
 * Quality: resolveFolderPath max depth, fileToSyncedItem mimeType field
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { fileToSyncedItem, listFolderContents, resolveFolderPath } from "./google-drive";

vi.mock("node:https", () => ({}));

const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch should not be called"));

afterAll(() => {
  fetchSpy.mockRestore();
});

describe("listFolderContents — folderId injection guard", () => {
  it("rejects a folderId containing a single quote", async () => {
    await expect(listFolderContents("access-token", "abc'def")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a folderId containing a backtick", async () => {
    await expect(listFolderContents("access-token", "abc`def")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a folderId containing a double quote", async () => {
    await expect(listFolderContents("access-token", 'abc"def')).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a folderId with spaces", async () => {
    await expect(listFolderContents("access-token", "abc def")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a folderId with a path traversal attempt", async () => {
    await expect(listFolderContents("access-token", "../secret")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a well-formed folderId (alphanumeric with hyphens and underscores)", async () => {
    fetchSpy.mockReset();
    fetchSpy.mockRejectedValue(new Error("network mock"));

    await expect(listFolderContents("access-token", "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs")).rejects.toThrow(
      "network mock",
    );
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("fileToSyncedItem — mimeType field", () => {
  it("includes mimeType in the returned SyncedItem", () => {
    const file = {
      id: "file-abc",
      name: "report.pdf",
      mimeType: "application/pdf",
      webViewLink: "https://drive.google.com/file/d/file-abc",
      createdTime: "2025-01-01T00:00:00Z",
      modifiedTime: "2025-03-01T00:00:00Z",
    };

    const item = fileToSyncedItem(file, "some content", "hash123", "My Drive / Reports", {});
    expect(item.mimeType).toBe("application/pdf");
  });

  it("preserves mimeType for Google Docs native format", () => {
    const file = {
      id: "doc-xyz",
      name: "My Doc",
      mimeType: "application/vnd.google-apps.document",
      webViewLink: "https://docs.google.com/document/d/doc-xyz",
    };

    const item = fileToSyncedItem(file, "exported text", null, null, {});
    expect(item.mimeType).toBe("application/vnd.google-apps.document");
  });
});

describe("resolveFolderPath — max depth guard", () => {
  it("stops traversal at 20 levels and returns a partial path", async () => {
    const folderIds = Array.from({ length: 25 }, (_, i) => `folder-${i}`);
    const folderCache = new Map<string, string>();

    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      const match = urlStr.match(/\/files\/(folder-\d+)/);
      if (!match) throw new Error("unexpected URL");
      const folderId = match[1];
      const idx = folderIds.indexOf(folderId);

      const hasParent = idx < folderIds.length - 1;
      return new Response(
        JSON.stringify({
          id: folderId,
          name: `Folder ${idx}`,
          parents: hasParent ? [folderIds[idx + 1]] : [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const file = { id: "leaf-file", name: "file.txt", mimeType: "text/plain", parents: [folderIds[0]] };
    const path = await resolveFolderPath(file, "My Drive", "access-token", folderCache);

    expect(typeof path).toBe("string");
    const segments = path.split(" / ");
    expect(segments.length).toBeLessThanOrEqual(21);
  });
});
