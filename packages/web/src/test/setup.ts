/**
 * Vitest jsdom setup for the web package: `@testing-library/jest-dom`, RTL `cleanup`, and MSW.
 *
 * `@phosphor-icons/react` and `lucide-react` are mocked with a Proxy that yields minimal `<svg>`
 * elements so barrel imports stay fast and `querySelector("svg")` still works in tests.
 *
 * When missing, installs `IntersectionObserver` (no-op), `EventSource` (minimal stub for SSE UIs),
 * and `window.matchMedia` (non-matching) so scroll detection, SSE, and responsive hooks do not throw.
 *
 * MSW listens in `beforeAll` with unhandled requests bypassed; each test resets handlers and runs
 * RTL cleanup; `afterAll` closes the server.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./msw";

const { createElement } = await import("react");
const iconStub = () => createElement("svg");
const iconProxy = new Proxy(
  {},
  {
    get: (_, name) => {
      if (name === "__esModule") return true;
      if (typeof name === "symbol" || name === "then" || name === "default") return undefined;
      return iconStub;
    },
    has: (_, name) => name !== "then" && name !== "default" && typeof name === "string",
  },
);
vi.mock("@phosphor-icons/react", () => iconProxy);
vi.mock("lucide-react", () => iconProxy);

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

if (typeof globalThis.EventSource === "undefined") {
  globalThis.EventSource = class EventSource extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readyState = 0;
    url: string;
    withCredentials = false;
    onopen: ((this: EventSource, ev: Event) => void) | null = null;
    onmessage: ((this: EventSource, ev: MessageEvent) => void) | null = null;
    onerror: ((this: EventSource, ev: Event) => void) | null = null;
    constructor(url: string | URL) {
      super();
      this.url = typeof url === "string" ? url : url.toString();
    }
    close() {
      this.readyState = 2;
    }
  } as unknown as typeof EventSource;
}

if (typeof window.matchMedia === "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
