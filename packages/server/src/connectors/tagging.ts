/**
 * Smart tagging pipeline.
 *
 * Two paths:
 * - Structured data (CSV/Sheets): deterministic extraction from headers, no LLM
 * - Unstructured docs: LLM-based tag + timeframe + summary extraction
 *
 * Batches large documents to stay within context limits.
 */
import type { Chunk } from "./chunking";

export interface FileContext {
  sourcePath?: string | null;
  createdAt?: string | null;
  modifiedAt?: string | null;
  wordCount?: number;
  sharedWith?: string[];
  siblingFileNames?: string[];
}

export interface TaggingResult {
  tags: string[];
  summary: string;
  timeframes: Array<{
    startDate: string;
    endDate?: string;
    context?: string;
  }>;
}

/**
 * Extract tags from structured data (CSV/spreadsheet content).
 * No LLM call — purely deterministic.
 */
export function tagStructuredContent(content: string, fileName: string, sourcePath?: string | null): TaggingResult {
  // For XLSX: content has "## SheetName\n<csv rows>" per sheet.
  // For CSV: content is raw rows with no sheet headers.
  // We scan ALL lines for sheet headers but only keep the header row + a few sample rows per sheet.
  const SAMPLE_ROWS_PER_SHEET = 10;
  const allLines = content.split("\n");

  if (allLines.length === 0 || !allLines.some((l) => l.trim())) {
    return { tags: [], summary: `Empty spreadsheet: ${fileName}`, timeframes: [] };
  }

  // First pass: find all sheets, capture header + sample rows, count total rows per sheet
  const sheets: Array<{ name: string; headers: string[]; rowCount: number; sampleLines: string[] }> = [];
  let currentSheet: { name: string; lines: string[]; rowCount: number; gotEnough: boolean } | null = null;

  for (const line of allLines) {
    if (line.startsWith("## ")) {
      // Flush previous sheet
      if (currentSheet) {
        sheets.push(parseSheetWithCount(currentSheet));
      }
      currentSheet = { name: line.slice(3).trim(), lines: [], rowCount: 0, gotEnough: false };
    } else if (line.trim()) {
      if (!currentSheet) {
        // No sheet headers (plain CSV) — treat as single sheet
        currentSheet = { name: fileName.replace(/\.[^.]+$/, ""), lines: [], rowCount: 0, gotEnough: false };
      }
      currentSheet.rowCount++;
      // Keep header row (first) + sample rows
      if (!currentSheet.gotEnough) {
        currentSheet.lines.push(line);
        if (currentSheet.lines.length >= SAMPLE_ROWS_PER_SHEET + 1) {
          currentSheet.gotEnough = true;
        }
      }
    }
  }
  if (currentSheet) {
    sheets.push(parseSheetWithCount(currentSheet));
  }

  // Collect tags from headers and sheet names
  const tags = new Set<string>();
  for (const sheet of sheets) {
    tags.add(sheet.name.toLowerCase());
    for (const header of sheet.headers) {
      const cleaned = header.toLowerCase().trim();
      if (cleaned && cleaned.length > 1 && cleaned.length < 50) {
        tags.add(cleaned);
      }
    }
  }

  // Detect date values from sample lines only
  const sampleContent = sheets.flatMap((s) => s.sampleLines).join("\n");
  const timeframes = extractDatesFromText(sampleContent);

  // Build summary
  const totalRows = sheets.reduce((sum, s) => sum + s.rowCount, 0);
  const sheetDesc = sheets
    .map((s) => `${s.name} (${s.rowCount.toLocaleString()} rows, columns: ${s.headers.join(", ")})`)
    .join("; ");
  const summary = `Spreadsheet with ${sheets.length} tab(s): ${sheetDesc}. ${totalRows.toLocaleString()} total rows.`;

  return {
    tags: [...tags].slice(0, 30),
    summary: summary.slice(0, 1000),
    timeframes,
  };
}

function parseSheetWithCount(sheet: {
  name: string;
  lines: string[];
  rowCount: number;
}): { name: string; headers: string[]; rowCount: number; sampleLines: string[] } {
  const headers = sheet.lines.length > 0 ? sheet.lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "")) : [];

  return {
    name: sheet.name,
    headers: headers.filter(Boolean),
    rowCount: Math.max(0, sheet.rowCount - 1), // subtract header row
    sampleLines: sheet.lines,
  };
}

/**
 * Deterministic tagging for short content (under ~100 words).
 * No LLM call — derives tags from file name, source path, and content.
 * Uses the content itself as the summary since it's short enough.
 */
export function tagShortContent(content: string, fileName: string, _sourcePath?: string | null): TaggingResult {
  const tags = new Set<string>();

  // Extract meaningful words from filename (skip very short/common words)
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");
  const words = nameWithoutExt.split(/[-_\s]+/).filter((w) => w.length > 2);
  for (const word of words.slice(0, 5)) {
    tags.add(word.toLowerCase());
  }

  const timeframes = extractDatesFromText(content);

  // Use content as summary, truncated
  const summary = content.replace(/\s+/g, " ").trim().slice(0, 500) || `Short document: ${fileName}`;

  return {
    tags: [...tags].slice(0, 15),
    summary,
    timeframes,
  };
}

/**
 * Build the LLM prompt for extracting tags, timeframes, and summary from document chunks.
 */
export function buildTaggingPrompt(
  chunks: Chunk[],
  fileName: string,
  orgContext?: string,
  fileContext?: FileContext,
): string {
  const chunkTexts = chunks.map((c) => `--- Section ${c.index + 1} ---\n${c.content}`).join("\n\n");

  const contextLines: string[] = [];
  if (orgContext) contextLines.push(`Organisation: ${orgContext}`);
  if (fileContext?.sourcePath) contextLines.push(`File location: ${fileContext.sourcePath}`);
  if (fileContext?.createdAt) contextLines.push(`Created: ${fileContext.createdAt}`);
  if (fileContext?.modifiedAt) contextLines.push(`Last modified: ${fileContext.modifiedAt}`);
  if (fileContext?.wordCount) contextLines.push(`Document size: ~${fileContext.wordCount} words`);
  if (fileContext?.sharedWith && fileContext.sharedWith.length > 0) {
    contextLines.push(`Shared with: ${fileContext.sharedWith.join(", ")}`);
  }
  if (fileContext?.siblingFileNames && fileContext.siblingFileNames.length > 0) {
    contextLines.push(`Other files in same folder: ${fileContext.siblingFileNames.join(", ")}`);
  }
  const contextBlock =
    contextLines.length > 0
      ? `\nContext (use this to understand what the document means to the team):\n${contextLines.join("\n")}\n`
      : "";

  return `Extract metadata from this document "${fileName}". Focus on information that a keyword search CANNOT find.
${contextBlock}

Respond with ONLY valid JSON matching this schema:
{
  "tags": ["tag1", "tag2", ...],
  "summary": "1-2 sentence summary",
  "temporal_references": [
    { "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD or null", "context": "what this date refers to" }
  ]
}

Tag rules (IMPORTANT — these make or break search quality):
- Extract 3-8 tags. Quality over quantity. Each tag must add search value beyond what keyword search already provides.
- Tag categories (in priority order):
  1. **Document type**: Determine this from the CONTENT STRUCTURE, not the title. Titles are often misleading. Look for signals:
     - Bullet points, pros/cons, "options" → discussion notes, meeting notes, decision log
     - Slides with headers → presentation, pitch deck
     - Step-by-step instructions → tutorial, how-to guide
     - Formal sections with requirements → technical spec, proposal
     - Narrative paragraphs with arguments → blog post, strategy doc, memo
     Examples: "pitch deck", "blog post", "meeting notes", "technical spec", "decision log", "discussion notes", "tutorial", "case study", "proposal"
  2. **Primary subject**: what/who is this document ABOUT? Only the main subject, not every entity mentioned. (e.g. if a pitch deck mentions 3 clients as examples, the primary subject is the company pitching, NOT the clients)
  3. **Intent/purpose**: why does this document exist? (e.g. "investor pitch", "internal planning", "how-to guide", "competitive analysis", "architecture decision")
  4. **Domain**: the specific field or discipline, but only if non-obvious from the title (e.g. "remarketing automation" not "marketing")
- Do NOT include:
  - Words already in the document title (keyword search handles that)
  - Names of entities that are merely mentioned/referenced (they're in the content, FTS5 finds them)
  - Generic topic words (e.g. "data", "analytics", "automation" — too broad to be useful)
- Lowercase, no special characters.

Summary: 2-3 sentences written from the perspective of someone inside the organisation who created this document. What role does this document play — is it a pitch to investors, a spec for engineers, notes from a meeting, a blog post for marketing? What key decisions, conclusions, or outcomes does it capture? Write it so a teammate can decide "yes, this is the doc I was looking for" without opening it.

Temporal references: any specific dates, quarters, months, or time periods mentioned. Use ISO format. Q1 2025 = start 2025-01-01, end 2025-03-31. Empty array if none found.

Document content:
${chunkTexts}`;
}

/**
 * Build the rollup prompt for merging batch tagging results into document-level metadata.
 */
export function buildRollupPrompt(
  batchResults: Array<{ tags: string[]; summary: string; temporal_references: unknown[] }>,
  fileName: string,
): string {
  return `Merge these batch extraction results into a single document-level summary for "${fileName}".

Batch results:
${JSON.stringify(batchResults, null, 2)}

Respond with ONLY valid JSON:
{
  "tags": ["merged unique tags, max 15"],
  "summary": "1-2 sentence document summary combining all batches",
  "temporal_references": [
    { "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD or null", "context": "description" }
  ]
}

Deduplicate tags and temporal references. Keep the most specific and useful tags. Prefer entities, document type, and intent tags over generic topic words.`;
}

/**
 * Parse LLM JSON response for tagging. Lenient — handles common LLM output quirks.
 */
export function parseTaggingResponse(response: string): TaggingResult | null {
  try {
    // Strip markdown code fences if present
    const cleaned = response
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    return {
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t: unknown) => typeof t === "string") : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      timeframes: Array.isArray(parsed.temporal_references)
        ? parsed.temporal_references
            .filter((t: Record<string, unknown>) => t && typeof t.start_date === "string")
            .map((t: Record<string, unknown>) => ({
              startDate: t.start_date as string,
              endDate: typeof t.end_date === "string" ? t.end_date : undefined,
              context: typeof t.context === "string" ? t.context : undefined,
            }))
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Simple date pattern extraction for structured data.
 * Finds ISO dates, MM/DD/YYYY, and quarter references.
 */
function extractDatesFromText(text: string): TaggingResult["timeframes"] {
  const timeframes: TaggingResult["timeframes"] = [];
  const seen = new Set<string>();

  // ISO dates: YYYY-MM-DD
  const isoMatches = text.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (isoMatches) {
    const dates = [...new Set(isoMatches)].sort();
    if (dates.length > 0) {
      const key = `${dates[0]}-${dates[dates.length - 1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        timeframes.push({
          startDate: dates[0],
          endDate: dates.length > 1 ? dates[dates.length - 1] : undefined,
          context: "date range in data",
        });
      }
    }
  }

  // Quarter references: Q1 2025, Q2 2024, etc.
  const quarterMatches = text.match(/\bQ([1-4])\s*(\d{4})\b/gi);
  if (quarterMatches) {
    for (const match of [...new Set(quarterMatches)]) {
      const qMatch = match.match(/Q([1-4])\s*(\d{4})/i);
      if (qMatch) {
        const q = Number.parseInt(qMatch[1]);
        const year = qMatch[2];
        const startMonth = String((q - 1) * 3 + 1).padStart(2, "0");
        const endMonth = String(q * 3).padStart(2, "0");
        const endDay = ({ 3: "31", 6: "30", 9: "30", 12: "31" } as Record<number, string>)[q * 3] ?? "31";
        const key = `${year}-Q${q}`;
        if (!seen.has(key)) {
          seen.add(key);
          timeframes.push({
            startDate: `${year}-${startMonth}-01`,
            endDate: `${year}-${endMonth}-${endDay}`,
            context: `Q${q} ${year}`,
          });
        }
      }
    }
  }

  return timeframes.slice(0, 10);
}
