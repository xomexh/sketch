/**
 * Binary file content extractors.
 *
 * Extracts plain text from common binary document formats:
 * - PDF   → pdf-parse v2 (PDFParse class, Mozilla pdf.js wrapper)
 * - DOCX  → mammoth (converts to plain text)
 * - XLSX  → xlsx/SheetJS (each sheet → CSV text)
 * - PPTX  → JSZip + regex XML parse (extracts slide text + notes)
 *
 * All extractors accept a Buffer and return a string (or null on failure).
 * They run in-process with no temp files — everything stays in memory.
 */
import type { Logger } from "pino";

/** Minimum characters for extraction to be considered successful. */
const MIN_TEXT_CHARS = 10;

/** MIME types handled by binary extractors. */
export const BINARY_EXTRACTABLE_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

/**
 * Extract text from a binary file buffer based on its MIME type.
 * Returns null if the format is unsupported or extraction fails.
 */
export async function extractTextFromBinary(
  buffer: ArrayBuffer,
  mimeType: string,
  logger: Logger,
): Promise<string | null> {
  try {
    const buf = Buffer.from(buffer);

    switch (mimeType) {
      case "application/pdf":
        return await extractPdf(buf, logger);

      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      case "application/msword":
        return await extractDocx(buf, logger);

      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      case "application/vnd.ms-excel":
        return await extractXlsx(buf, logger);

      case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      case "application/vnd.ms-powerpoint":
        return await extractPptx(buf, logger);

      default:
        return null;
    }
  } catch (err) {
    logger.warn({ err, mimeType }, "Binary content extraction failed");
    return null;
  }
}

/**
 * Extracts plain text from a PDF buffer.
 * Returns null if the extracted text is too short — typically a scanned or image-only PDF.
 */
async function extractPdf(buffer: Buffer, logger: Logger): Promise<string | null> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();

  const text = result.text?.trim();
  if (!text || text.length < MIN_TEXT_CHARS) {
    logger.debug("PDF extraction yielded minimal text (possibly scanned/image-only)");
    return null;
  }

  await parser.destroy();
  return text;
}

/**
 * Extracts plain text from a DOCX buffer via mammoth.
 * @remarks
 * mammoth ships as a CJS module with no type declarations, so the import is cast manually
 * and the default export is unwrapped as a fallback for bundler differences.
 */
async function extractDocx(buffer: Buffer, logger: Logger): Promise<string | null> {
  const mammoth = (await import("mammoth")) as {
    extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const fn = mammoth.extractRawText ?? (mammoth as unknown as { default: typeof mammoth }).default?.extractRawText;
  const result = await fn({ buffer });

  const text = result.value?.trim();
  if (!text || text.length < MIN_TEXT_CHARS) {
    logger.debug("DOCX extraction yielded minimal text");
    return null;
  }
  return text;
}

/** Extracts text from an XLSX buffer by converting each sheet to CSV, prefixed with a `## SheetName` header. */
async function extractXlsx(buffer: Buffer, _logger: Logger): Promise<string | null> {
  const XLSX = await import("xlsx");
  const read = XLSX.read ?? (XLSX as unknown as { default: typeof XLSX }).default?.read;
  const utils = XLSX.utils ?? (XLSX as unknown as { default: typeof XLSX }).default?.utils;
  const workbook = read(buffer, { type: "buffer" });

  const sections: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const csv: string = utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv?.trim()) {
      sections.push(`## ${sheetName}\n${csv.trim()}`);
    }
  }

  if (sections.length === 0) return null;
  return sections.join("\n\n");
}

/**
 * Extract text from PPTX by unzipping and parsing slide XML.
 *
 * PPTX files are ZIP archives containing XML slide files at `ppt/slides/slideN.xml`
 * and optional speaker notes at `ppt/notesSlides/notesSlideN.xml`.
 * We extract all `<a:t>` text nodes from each slide.
 */
async function extractPptx(buffer: Buffer, _logger: Logger): Promise<string | null> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = Number.parseInt(a.match(/slide(\d+)/)?.[1] ?? "0", 10);
      const numB = Number.parseInt(b.match(/slide(\d+)/)?.[1] ?? "0", 10);
      return numA - numB;
    });

  const noteFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = Number.parseInt(a.match(/notesSlide(\d+)/)?.[1] ?? "0", 10);
      const numB = Number.parseInt(b.match(/notesSlide(\d+)/)?.[1] ?? "0", 10);
      return numA - numB;
    });

  const slideTexts: string[] = [];

  for (let i = 0; i < slideFiles.length; i++) {
    const slideXml = await zip.files[slideFiles[i]].async("string");
    const slideText = extractXmlText(slideXml);

    let noteText = "";
    if (noteFiles[i]) {
      const noteXml = await zip.files[noteFiles[i]].async("string");
      noteText = extractXmlText(noteXml);
    }

    const parts = [`## Slide ${i + 1}`];
    if (slideText) parts.push(slideText);
    if (noteText) parts.push(`Notes: ${noteText}`);

    if (slideText || noteText) {
      slideTexts.push(parts.join("\n"));
    }
  }

  if (slideTexts.length === 0) return null;
  return slideTexts.join("\n\n");
}

/**
 * Extract text content from Office Open XML by finding all <a:t> elements.
 * These are the text run elements used in PowerPoint's slide XML.
 */
function extractXmlText(xml: string): string {
  const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g);
  if (!matches) return "";

  const texts = matches.map((m) => m.replace(/<[^>]+>/g, "").trim()).filter(Boolean);

  return texts.join(" ");
}
