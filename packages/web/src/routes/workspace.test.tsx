/**
 * Tests for the WorkspacePage file browser component.
 *
 * Strategy:
 * - Mock all workspace API hooks at the module level so tests control query/mutation state
 *   without hitting any HTTP server.
 * - Mock Monaco (lazy-loaded) with a simple textarea so editing can be tested.
 * - Mock useIsMobile to exercise both desktop and mobile layouts.
 * - Use vi.useFakeTimers() for the 300 ms debounce test, then restore real timers.
 * - Action bar tooltip-trigger buttons have no accessible name (the tooltip content is in a
 *   portal and only appears on hover). Select them via data-slot attribute queries instead.
 */
import { renderWithProviders } from "@/test/utils";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./workspace";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { x: 0, y: 0, width: 100, height: 20, top: 0, right: 100, bottom: 20, left: 0, toJSON: () => ({}) };
};

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange?: (v: string) => void;
  }) => <textarea data-testid="monaco-editor" value={value} onChange={(e) => onChange?.(e.target.value)} />,
}));

const mockMutateAsync = vi.fn().mockResolvedValue({});

const defaultQueryResult = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
};

const mockUseFiles = vi.fn();
const mockUseSearchFiles = vi.fn();
const mockUseFileContent = vi.fn();
const mockUseSaveFile = vi.fn();
const mockUseUploadFile = vi.fn();
const mockUseCreateFolder = vi.fn();
const mockUseCreateFile = vi.fn();
const mockUseDeleteFile = vi.fn();
const mockUseRenameFile = vi.fn();

vi.mock("@/api/workspace", () => ({
  useFiles: (...args: unknown[]) => mockUseFiles(...args),
  useSearchFiles: (...args: unknown[]) => mockUseSearchFiles(...args),
  useFileContent: (...args: unknown[]) => mockUseFileContent(...args),
  useSaveFile: () => mockUseSaveFile(),
  useUploadFile: () => mockUseUploadFile(),
  useCreateFolder: () => mockUseCreateFolder(),
  useCreateFile: () => mockUseCreateFile(),
  useDeleteFile: () => mockUseDeleteFile(),
  useRenameFile: () => mockUseRenameFile(),
}));

const mockIsMobile = vi.fn(() => false);
vi.mock("@sketch/ui/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile(),
}));

const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

function makeMutation(overrides: object = {}) {
  return {
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  };
}

function makeFileMetadata(overrides: object = {}) {
  return {
    name: "file.txt",
    path: "file.txt",
    isDirectory: false,
    isEditable: true,
    size: 100,
    modifiedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeStableFilesResult(files: ReturnType<typeof makeFileMetadata>[]) {
  const stableFiles = files;
  return {
    ...defaultQueryResult,
    data: { files: stableFiles },
  };
}

/** Find the action bar (Upload, New File, New Folder buttons) container. */
function getActionBar() {
  return document.querySelector("[class*='justify-end gap-1 px-2 py-1 border-b']");
}

/** Reset all mocks to sensible defaults before each test. */
function setupDefaultMocks() {
  mockIsMobile.mockReturnValue(false);

  mockUseFiles.mockReturnValue(makeStableFilesResult([]));
  mockUseSearchFiles.mockReturnValue({ ...defaultQueryResult, data: { files: [] } });
  mockUseFileContent.mockReturnValue({ ...defaultQueryResult, data: null });

  mockUseSaveFile.mockReturnValue(makeMutation());
  mockUseUploadFile.mockReturnValue(makeMutation());
  mockUseCreateFolder.mockReturnValue(makeMutation());
  mockUseCreateFile.mockReturnValue(makeMutation());
  mockUseDeleteFile.mockReturnValue(makeMutation());
  mockUseRenameFile.mockReturnValue(makeMutation());
}

describe("WorkspacePage", () => {
  beforeEach(() => {
    setupDefaultMocks();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({});
    mockInvalidateQueries.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders workspace scope switcher and action bar", () => {
    renderWithProviders(<WorkspacePage />);
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search files...")).toBeInTheDocument();
  });

  it("renders file list from API", () => {
    mockUseFiles.mockReturnValue(
      makeStableFilesResult([
        makeFileMetadata({ name: "readme.md", path: "readme.md" }),
        makeFileMetadata({ name: "src", path: "src", isDirectory: true }),
      ]),
    );

    renderWithProviders(<WorkspacePage />);

    expect(screen.getByText("readme.md")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
  });

  it("shows empty state when directory has no files", () => {
    mockUseFiles.mockReturnValue(makeStableFilesResult([]));
    renderWithProviders(<WorkspacePage />);
    expect(screen.getByText("No files yet")).toBeInTheDocument();
  });

  it("shows loading state while root files are being fetched", () => {
    mockUseFiles.mockReturnValue({
      ...defaultQueryResult,
      isLoading: true,
      data: undefined,
    });

    renderWithProviders(<WorkspacePage />);

    expect(screen.queryByText("No files yet")).not.toBeInTheDocument();
  });

  it("clicking folder expands it and triggers lazy load of children", async () => {
    const user = userEvent.setup();

    const rootResult = makeStableFilesResult([makeFileMetadata({ name: "src", path: "src", isDirectory: true })]);
    const srcResult = makeStableFilesResult([makeFileMetadata({ name: "index.ts", path: "src/index.ts" })]);
    const emptyResult = makeStableFilesResult([]);

    mockUseFiles.mockImplementation((_scope: string, path: string) => {
      if (path === ".") return rootResult;
      if (path === "src") return srcResult;
      return emptyResult;
    });

    renderWithProviders(<WorkspacePage />);

    await user.click(screen.getByRole("button", { name: "Folder: src" }));

    await waitFor(() => {
      expect(screen.getByText("index.ts")).toBeInTheDocument();
    });
  });

  it("clicking a file opens it in the editor", async () => {
    const user = userEvent.setup();

    mockUseFiles.mockReturnValue(makeStableFilesResult([makeFileMetadata({ name: "hello.txt", path: "hello.txt" })]));

    mockUseFileContent.mockReturnValue({
      ...defaultQueryResult,
      data: { content: "Hello world", isText: true, size: 11, mimeType: "text/plain" },
    });

    renderWithProviders(<WorkspacePage />);

    await user.click(screen.getByRole("button", { name: "File: hello.txt" }));

    await waitFor(() => {
      expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    });
  });

  it("shows loading state while file content is fetching", async () => {
    const user = userEvent.setup();

    mockUseFiles.mockReturnValue(makeStableFilesResult([makeFileMetadata({ name: "slow.txt", path: "slow.txt" })]));

    mockUseFileContent.mockReturnValue({
      ...defaultQueryResult,
      isLoading: true,
      data: null,
    });

    renderWithProviders(<WorkspacePage />);

    await user.click(screen.getByRole("button", { name: "File: slow.txt" }));

    await waitFor(() => {
      const matches = screen.getAllByText("slow.txt");
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
  });

  it("editing file marks it as dirty with visual indicator", async () => {
    const user = userEvent.setup();

    mockUseFiles.mockReturnValue(makeStableFilesResult([makeFileMetadata({ name: "notes.txt", path: "notes.txt" })]));

    mockUseFileContent.mockReturnValue({
      ...defaultQueryResult,
      data: { content: "original", isText: true, size: 8, mimeType: "text/plain" },
    });

    renderWithProviders(<WorkspacePage />);

    await user.click(screen.getByRole("button", { name: "File: notes.txt" }));
    await waitFor(() => expect(screen.getByTestId("monaco-editor")).toBeInTheDocument());

    const editor = screen.getByTestId("monaco-editor");
    await user.clear(editor);
    await user.type(editor, "modified content");

    await waitFor(() => {
      expect(screen.getByText("●")).toBeInTheDocument();
    });
  });

  it("save calls the save API and is triggered by save button", async () => {
    const user = userEvent.setup();

    mockUseFiles.mockReturnValue(makeStableFilesResult([makeFileMetadata({ name: "doc.md", path: "doc.md" })]));

    mockUseFileContent.mockReturnValue({
      ...defaultQueryResult,
      data: { content: "# Title", isText: true, size: 7, mimeType: "text/markdown" },
    });

    renderWithProviders(<WorkspacePage />);

    await user.click(screen.getByRole("button", { name: "File: doc.md" }));
    await waitFor(() => expect(screen.getByTestId("monaco-editor")).toBeInTheDocument());

    const editor = screen.getByTestId("monaco-editor");
    await user.clear(editor);
    await user.type(editor, "# Updated");

    await waitFor(() => expect(screen.getByText("●")).toBeInTheDocument());

    const saveBtn = document.querySelector("[data-slot='tooltip-trigger'][data-variant='default']");
    expect(saveBtn).toBeTruthy();
    await user.click(saveBtn as HTMLElement);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ path: "doc.md" }));
    });
  });

  it("Ctrl+S keyboard shortcut saves the file", async () => {
    const user = userEvent.setup();

    mockUseFiles.mockReturnValue(makeStableFilesResult([makeFileMetadata({ name: "ctrl-s.ts", path: "ctrl-s.ts" })]));

    mockUseFileContent.mockReturnValue({
      ...defaultQueryResult,
      data: { content: "const x = 1;", isText: true, size: 12, mimeType: "text/plain" },
    });

    renderWithProviders(<WorkspacePage />);

    await user.click(screen.getByRole("button", { name: "File: ctrl-s.ts" }));
    await waitFor(() => expect(screen.getByTestId("monaco-editor")).toBeInTheDocument());

    const editor = screen.getByTestId("monaco-editor");
    await user.clear(editor);
    await user.type(editor, "const x = 2;");

    await waitFor(() => expect(screen.getByText("●")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ path: "ctrl-s.ts" }));
    });
  });

  it("binary file click shows binary view in editor pane (no navigation away)", async () => {
    const user = userEvent.setup();

    mockUseFiles.mockReturnValue(
      makeStableFilesResult([makeFileMetadata({ name: "image.png", path: "image.png", isEditable: false })]),
    );

    mockUseFileContent.mockReturnValue({ ...defaultQueryResult, data: null });

    renderWithProviders(<WorkspacePage />);

    await user.click(screen.getByRole("button", { name: "File: image.png" }));

    await waitFor(() => {
      expect(screen.getByText("Binary files cannot be edited in the browser")).toBeInTheDocument();
    });
  });

  it("upload button triggers hidden file input click", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkspacePage />);

    const fileInput = document.querySelector("input[type='file']") as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click");

    const actionBar = getActionBar();
    expect(actionBar).toBeTruthy();
    const tooltipTriggers = actionBar?.querySelectorAll("[data-slot='tooltip-trigger']") ?? [];
    const uploadBtn = tooltipTriggers[0] as HTMLElement;
    await user.click(uploadBtn);

    expect(clickSpy).toHaveBeenCalled();
  });

  it("new folder via action bar creates folder at root", async () => {
    const user = userEvent.setup();

    mockUseFiles.mockReturnValue(
      makeStableFilesResult([makeFileMetadata({ name: "existing.txt", path: "existing.txt" })]),
    );

    renderWithProviders(<WorkspacePage />);

    const actionBar = getActionBar();
    expect(actionBar).toBeTruthy();
    const tooltipTriggers = actionBar?.querySelectorAll("[data-slot='tooltip-trigger']") ?? [];
    const newFolderBtn = tooltipTriggers[2] as HTMLElement;
    await user.click(newFolderBtn);

    const input = screen.getByPlaceholderText("Folder name...");
    await user.type(input, "my-folder{Enter}");

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ path: "my-folder" }));
    });
  });

  it("new folder via folder hover menu creates inside that folder", async () => {
    const user = userEvent.setup();

    const rootResult = makeStableFilesResult([makeFileMetadata({ name: "docs", path: "docs", isDirectory: true })]);
    const emptyResult = makeStableFilesResult([]);

    mockUseFiles.mockImplementation((_scope: string, path: string) => {
      if (path === ".") return rootResult;
      return emptyResult;
    });

    renderWithProviders(<WorkspacePage />);

    await user.click(screen.getByRole("button", { name: "Folder: docs" }));

    await waitFor(() => {
      expect(screen.getByText("Empty folder")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Create inside folder" })).toBeInTheDocument();

    const actionBar = getActionBar();
    const tooltipTriggers = actionBar?.querySelectorAll("[data-slot='tooltip-trigger']") ?? [];
    const newFolderBtn = tooltipTriggers[2] as HTMLElement;
    await user.click(newFolderBtn);

    const input = await screen.findByPlaceholderText("Folder name...");
    await user.type(input, "sub-folder{Enter}");

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ path: "docs/sub-folder" }));
    });
  });

  it("new folder via folder plus menu focuses the inline create input", async () => {
    const user = userEvent.setup();

    const rootResult = makeStableFilesResult([makeFileMetadata({ name: "docs", path: "docs", isDirectory: true })]);
    const emptyResult = makeStableFilesResult([]);

    mockUseFiles.mockImplementation((_scope: string, path: string) => {
      if (path === ".") return rootResult;
      return emptyResult;
    });

    renderWithProviders(<WorkspacePage />);

    await user.click(screen.getByRole("button", { name: "Folder: docs" }));

    await waitFor(() => {
      expect(screen.getByText("Empty folder")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Create inside folder" }));
    await user.click(await screen.findByRole("menuitem", { name: "New Folder" }));

    const input = await screen.findByPlaceholderText("Folder name...");

    await waitFor(() => {
      expect(input).toHaveFocus();
    });
  });

  it("delete shows confirmation dialog and calls API on confirm", async () => {
    const user = userEvent.setup();

    mockUseFiles.mockReturnValue(makeStableFilesResult([makeFileMetadata({ name: "old.txt", path: "old.txt" })]));

    renderWithProviders(<WorkspacePage />);

    const fileBtn = screen.getByRole("button", { name: "File: old.txt" });
    await user.hover(fileBtn);

    const innerBtns = within(fileBtn).getAllByRole("button");
    const contextMenuTrigger = innerBtns[innerBtns.length - 1];
    await user.click(contextMenuTrigger);

    const deleteItem = await screen.findByRole("menuitem", { name: /Delete/i });
    await user.click(deleteItem);

    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    const dialog = screen.getByRole("alertdialog");
    const confirmBtn = within(dialog).getByRole("button", { name: /Delete/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ path: "old.txt" }));
    });
  });

  it("rename opens inline input and confirms on Enter", async () => {
    const user = userEvent.setup();

    mockUseFiles.mockReturnValue(
      makeStableFilesResult([makeFileMetadata({ name: "old-name.txt", path: "old-name.txt" })]),
    );

    renderWithProviders(<WorkspacePage />);

    const fileBtn = screen.getByRole("button", { name: "File: old-name.txt" });
    await user.hover(fileBtn);

    const innerBtns = within(fileBtn).getAllByRole("button");
    const contextMenuTrigger = innerBtns[innerBtns.length - 1];
    await user.click(contextMenuTrigger);

    const renameItem = await screen.findByRole("menuitem", { name: /Rename/i });
    await user.click(renameItem);

    const renameInput = await screen.findByDisplayValue("old-name.txt");
    await user.clear(renameInput);
    await user.type(renameInput, "new-name.txt");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ oldPath: "old-name.txt", newPath: "new-name.txt" }),
      );
    });
  });

  it("rename cancels on Escape without calling API", async () => {
    const user = userEvent.setup();

    mockUseFiles.mockReturnValue(makeStableFilesResult([makeFileMetadata({ name: "keep.txt", path: "keep.txt" })]));

    renderWithProviders(<WorkspacePage />);

    const fileBtn = screen.getByRole("button", { name: "File: keep.txt" });
    await user.hover(fileBtn);

    const innerBtns = within(fileBtn).getAllByRole("button");
    const contextMenuTrigger = innerBtns[innerBtns.length - 1];
    await user.click(contextMenuTrigger);

    const renameItem = await screen.findByRole("menuitem", { name: /Rename/i });
    await user.click(renameItem);

    const renameInput = await screen.findByDisplayValue("keep.txt");
    await user.clear(renameInput);
    await user.type(renameInput, "different");
    fireEvent.keyDown(renameInput, { key: "Escape" });

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("different")).not.toBeInTheDocument();
  });

  it("search with debounce fires query after 300ms delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    renderWithProviders(<WorkspacePage />);

    const searchInput = screen.getByPlaceholderText("Search files...");

    fireEvent.change(searchInput, { target: { value: "hello" } });

    const callsBefore = (mockUseSearchFiles.mock.calls as string[][]).filter((c) => c[0] === "hello");
    expect(callsBefore.length).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    expect(mockUseSearchFiles).toHaveBeenCalledWith("personal", "hello");

    vi.useRealTimers();
  });

  it("mobile layout uses flex-col container class", () => {
    mockIsMobile.mockReturnValue(true);
    renderWithProviders(<WorkspacePage />);

    const mobileRoot = document.querySelector(".flex-col.overflow-hidden");
    expect(mobileRoot).toBeInTheDocument();
  });

  it("mobile layout shows tree pane with close button", () => {
    mockIsMobile.mockReturnValue(true);
    renderWithProviders(<WorkspacePage />);

    expect(screen.getByPlaceholderText("Search files...")).toBeInTheDocument();

    const headerRow = screen.getByText("Personal").closest("[class*='justify-between']");
    const headerBtns = headerRow?.querySelectorAll("button");
    expect(headerBtns).toBeTruthy();
    expect(headerBtns?.length).toBe(3);
  });

  it("error boundary wraps the editor area — page renders without crash", () => {
    mockUseFiles.mockReturnValue(makeStableFilesResult([makeFileMetadata({ name: "ok.ts", path: "ok.ts" })]));

    renderWithProviders(<WorkspacePage />);
    expect(screen.getByText("Personal")).toBeInTheDocument();
  });

  it("empty directory shows Empty folder message in folder contents", async () => {
    const user = userEvent.setup();

    const rootResult = makeStableFilesResult([
      makeFileMetadata({ name: "empty-dir", path: "empty-dir", isDirectory: true }),
    ]);
    const emptyResult = makeStableFilesResult([]);

    mockUseFiles.mockImplementation((_scope: string, path: string) => {
      if (path === ".") return rootResult;
      return emptyResult;
    });

    renderWithProviders(<WorkspacePage />);

    await user.click(screen.getByRole("button", { name: "Folder: empty-dir" }));

    await waitFor(() => {
      expect(screen.getByText("Empty folder")).toBeInTheDocument();
    });
  });
});
