import { describe, expect, it, vi } from "vitest";
import { UserCache } from "./user-cache";

describe("UserCache", () => {
  it("calls fetcher on cache miss and returns result", async () => {
    const cache = new UserCache();
    const fetcher = vi.fn().mockResolvedValue({ name: "alice", realName: "Alice Smith", email: "alice@example.com" });

    const result = await cache.resolve("U001", fetcher);

    expect(fetcher).toHaveBeenCalledWith("U001");
    expect(result).toEqual({ name: "alice", realName: "Alice Smith", email: "alice@example.com" });
  });

  it("returns cached result on cache hit without calling fetcher", async () => {
    const cache = new UserCache();
    const fetcher = vi.fn().mockResolvedValue({ name: "alice", realName: "Alice Smith", email: "alice@example.com" });

    await cache.resolve("U001", fetcher);
    const result = await cache.resolve("U001", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ name: "alice", realName: "Alice Smith", email: "alice@example.com" });
  });

  it("caches different user IDs independently", async () => {
    const cache = new UserCache();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ name: "alice", realName: "Alice Smith", email: "alice@example.com" })
      .mockResolvedValueOnce({ name: "bob", realName: "Bob Jones", email: "bob@example.com" });

    const alice = await cache.resolve("U001", fetcher);
    const bob = await cache.resolve("U002", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(alice.realName).toBe("Alice Smith");
    expect(bob.realName).toBe("Bob Jones");
  });

  it("propagates fetcher errors", async () => {
    const cache = new UserCache();
    const fetcher = vi.fn().mockRejectedValue(new Error("Slack API down"));

    await expect(cache.resolve("U001", fetcher)).rejects.toThrow("Slack API down");
  });

  it("does not cache failed lookups", async () => {
    const cache = new UserCache();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ name: "alice", realName: "Alice Smith", email: "alice@example.com" });

    await expect(cache.resolve("U001", fetcher)).rejects.toThrow("transient");
    const result = await cache.resolve("U001", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.realName).toBe("Alice Smith");
  });
});
