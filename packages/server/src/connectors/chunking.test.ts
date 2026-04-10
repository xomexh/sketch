import { describe, expect, it } from "vitest";
import { chunkText } from "./chunking";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const text = "Hello world. This is a short document.";
    const chunks = chunkText(text, { maxTokens: 500 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it("returns empty array for empty input", () => {
    expect(chunkText("")).toHaveLength(0);
    expect(chunkText("   ")).toHaveLength(0);
  });

  it("splits at paragraph boundaries (double newline)", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i + 1}: ${"word ".repeat(30).trim()}`);
    const text = paragraphs.join("\n\n");

    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("respects the max token limit per chunk", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i + 1}: ${"word ".repeat(20).trim()}`);
    const text = paragraphs.join("\n\n");

    const maxTokens = 200;
    const chunks = chunkText(text, { maxTokens, overlapTokens: 20 });

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(maxTokens * 1.5);
    }
  });

  it("chunk indices are sequential starting at 0", () => {
    const text = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}: ${"text ".repeat(30)}`).join("\n\n");
    const chunks = chunkText(text, { maxTokens: 50 });

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  it("content from all chunks covers the original text", () => {
    const paragraphs = Array.from({ length: 5 }, (_, i) => `Section ${i + 1}: important content about topic ${i + 1}`);
    const text = paragraphs.join("\n\n");

    const chunks = chunkText(text, { maxTokens: 30, overlapTokens: 5 });

    for (const para of paragraphs) {
      const appearsInChunk = chunks.some((c) => c.content.includes(`Section ${para.split(":")[0].split(" ")[1]}`));
      expect(appearsInChunk).toBe(true);
    }
  });

  it("handles text with no paragraph breaks (single block)", () => {
    const text = "word ".repeat(600).trim();

    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
