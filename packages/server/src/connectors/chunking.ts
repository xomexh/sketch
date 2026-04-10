/**
 * Text chunking for embedding.
 *
 * Splits text into overlapping chunks suitable for embedding.
 * Uses a simple token estimation (1 token ≈ 4 chars) to avoid
 * depending on a tokenizer library.
 */

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
}

interface ChunkOptions {
  /** Target tokens per chunk. Default: 500. */
  maxTokens?: number;
  /** Overlap tokens between chunks. Default: 50. */
  overlapTokens?: number;
}

/** Rough token estimate: 1 token ≈ 4 characters. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into overlapping chunks.
 *
 * Strategy: split on paragraph boundaries first, then sentence boundaries,
 * accumulating until we hit the token limit. This preserves natural text
 * structure better than fixed-size character splits.
 *
 * If the trimmed input fits under the token limit, returns a single chunk.
 * Otherwise: split on paragraphs (double newlines). When adding a paragraph
 * would overflow, flush the current buffer (keeping a tail slice for overlap),
 * then if the paragraph alone is still too large, subdivide by sentences, by
 * lines when sentence boundaries are not meaningful (e.g. CSV or code), then
 * by fixed character slices. After the loop, emit any trailing buffer that is
 * not only overlap carry-over from the last flush.
 */
export function chunkText(text: string, opts?: ChunkOptions): Chunk[] {
  const maxTokens = opts?.maxTokens ?? 500;
  const overlapTokens = opts?.overlapTokens ?? 50;
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;

  const trimmed = text.trim();
  if (!trimmed) return [];

  if (estimateTokens(trimmed) <= maxTokens) {
    return [{ index: 0, content: trimmed, tokenCount: estimateTokens(trimmed) }];
  }

  const paragraphs = trimmed.split(/\n\s*\n/).filter((p) => p.trim());

  const chunks: Chunk[] = [];
  let current = "";
  let overlapBuffer = "";

  function flushChunk() {
    const content = current.trim();
    if (content) {
      chunks.push({
        index: chunks.length,
        content,
        tokenCount: estimateTokens(content),
      });

      overlapBuffer = content.length > overlapChars ? content.slice(-overlapChars) : content;
    }
    current = overlapBuffer;
  }

  for (const para of paragraphs) {
    const paraWithSep = para.trim();

    if (current.length + paraWithSep.length + 2 > maxChars) {
      if (current.length > overlapChars) {
        flushChunk();
      }

      if (paraWithSep.length > maxChars) {
        const sentences = paraWithSep.split(/(?<=[.!?])\s+/);

        const segments = sentences.length <= 1 && paraWithSep.includes("\n") ? paraWithSep.split("\n") : sentences;

        for (const segment of segments) {
          if (segment.length > maxChars) {
            let pos = 0;
            while (pos < segment.length) {
              const available = Math.max(1, maxChars - (current ? current.length + 1 : 0));
              const slice = segment.slice(pos, pos + available);
              if (current.length + slice.length + 1 > maxChars && current.length > overlapChars) {
                flushChunk();
              }
              current += (current ? " " : "") + slice;
              pos += slice.length;
              if (current.length >= maxChars - overlapChars) {
                flushChunk();
              }
            }
          } else {
            if (current.length + segment.length + 1 > maxChars && current.length > overlapChars) {
              flushChunk();
            }
            current += (current ? " " : "") + segment;
          }
        }
      } else {
        current += (current ? "\n\n" : "") + paraWithSep;
      }
    } else {
      current += (current ? "\n\n" : "") + paraWithSep;
    }
  }

  if (current.trim() && current.trim() !== overlapBuffer.trim()) {
    const content = current.trim();
    chunks.push({
      index: chunks.length,
      content,
      tokenCount: estimateTokens(content),
    });
  }

  return chunks;
}
