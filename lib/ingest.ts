/**
 * Runtime document ingestion.
 * Supports three modes, selectable per-document:
 *  - "liteparse"  — local, in-process parsing via @llamaindex/liteparse
 *  - "llamaparse" — LlamaCloud Parse API with granular (word-level) bounding boxes
 *  - "auto"       — LiteParse for the whole document, then selectively re-parse
 *                   only the pages LiteParse flags as hard (OCR needed, tables,
 *                   multi-column) with LlamaParse's cost-effective tier
 * All produce the same Document/PageData shape so the rest of the app
 * (search, citation grounding, screenshots) is parser-agnostic.
 */
import fs from "fs";
import { LiteParse } from "@llamaindex/liteparse";
import type { Document, PageData } from "./store";

export type ParserType = "liteparse" | "llamaparse" | "auto";

/** Auto mode is only offered when we can actually reach LlamaCloud. */
export function isAutoAvailable(): boolean {
  return !!process.env.LLAMA_CLOUD_API_KEY;
}

const parsers = new Map<boolean, LiteParse>();

function getParser(includeComplexity = false): LiteParse {
  let p = parsers.get(includeComplexity);
  if (!p) {
    p = new LiteParse({
      outputFormat: "json",
      ocrEnabled: false,
      includeComplexity,
    });
    parsers.set(includeComplexity, p);
  }
  return p;
}

/**
 * Parse a PDF file and return a Document ready to add to the store.
 */
export async function ingestPdf(
  filePath: string,
  filename: string,
  parserType: ParserType = "liteparse",
): Promise<Document> {
  if (parserType === "auto") {
    const { pages, upgradedPages } = await parseWithAuto(filePath);
    return { filename, pages, parser: "auto", upgradedPages };
  }

  const pages =
    parserType === "llamaparse"
      ? await parseWithLlamaParse(filePath)
      : await parseWithLiteParse(filePath);

  return { filename, pages, parser: parserType };
}

function toPageData(pg: {
  pageNum: number;
  width: number;
  height: number;
  text: string;
  textItems: Array<{
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontName?: string;
    fontSize?: number;
  }>;
}): PageData {
  return {
    pageNum: pg.pageNum,
    width: pg.width,
    height: pg.height,
    text: pg.text,
    textItems: pg.textItems.map((item) => ({
      text: item.text,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      fontName: item.fontName,
      fontSize: item.fontSize,
    })),
  };
}

async function parseWithLiteParse(filePath: string): Promise<PageData[]> {
  const result = await getParser().parse(filePath);
  return result.pages.map(toPageData);
}

// --- Auto mode: LiteParse everywhere, LlamaParse on the hard pages ---

/**
 * OCR reasons where a second pass can actually recover content.
 *
 * Deliberately excludes "sparse-text" and "no-text" on their own: in a
 * digital-native filing those fire on blank spillover pages and pages holding
 * nothing but a running footer, where there is nothing for LlamaParse to find.
 * (On a real scan those pages also carry "scanned"/"embedded-images", so
 * genuinely rasterized pages still route through.)
 */
const RECOVERABLE_OCR_REASONS = new Set([
  "scanned",
  "garbled",
  "embedded-images",
  "vector-text",
  "annotation-text",
]);

interface PageComplexity {
  needsOcr: boolean;
  reasons: string[];
  layout?: { isComplex: boolean; reasons: string[] } | null;
}

/**
 * Decide whether a page is worth spending a LlamaParse call on.
 * Two independent triggers: the page needs OCR for a recoverable reason, or its
 * layout is complex (tables, multi-column, dense graphics) — the cases where
 * LiteParse's flat text extraction loses structure LlamaParse preserves.
 */
function shouldUpgrade(c: PageComplexity | null | undefined): boolean {
  if (!c) return false;
  if (c.layout?.isComplex) return true;
  return c.needsOcr && c.reasons.some((r) => RECOVERABLE_OCR_REASONS.has(r));
}

async function parseWithAuto(
  filePath: string,
): Promise<{ pages: PageData[]; upgradedPages: number[] }> {
  const result = await getParser(true).parse(filePath);
  const pages = result.pages.map(toPageData);

  const upgradedPages = result.pages
    .filter((pg) => shouldUpgrade(pg.complexity as PageComplexity | undefined))
    .map((pg) => pg.pageNum);

  if (upgradedPages.length === 0) {
    console.log(
      `[auto] ${pages.length} pages, none flagged — staying on LiteParse`,
    );
    return { pages, upgradedPages };
  }

  console.log(
    `[auto] upgrading ${upgradedPages.length}/${pages.length} pages with LlamaParse: ${formatPageRanges(upgradedPages)}`,
  );

  let upgraded: PageData[];
  try {
    upgraded = await parseWithLlamaParse(filePath, upgradedPages);
  } catch (e) {
    // A failed upgrade is not a failed ingest — keep the LiteParse pages.
    console.warn(
      `[auto] LlamaParse upgrade failed, keeping LiteParse output: ${e instanceof Error ? e.message : e}`,
    );
    return { pages, upgradedPages: [] };
  }

  const byPageNum = new Map(pages.map((p) => [p.pageNum, p]));
  const applied: number[] = [];
  for (const up of upgraded) {
    const original = byPageNum.get(up.pageNum);
    if (!original) continue;
    // LlamaParse reports its own page dimensions; fall back to LiteParse's when
    // absent so screenshot overlays keep a valid coordinate space.
    byPageNum.set(up.pageNum, {
      ...up,
      width: up.width || original.width,
      height: up.height || original.height,
      text: up.text || original.text,
    });
    applied.push(up.pageNum);
  }

  return {
    pages: pages.map((p) => byPageNum.get(p.pageNum)!),
    upgradedPages: applied.sort((a, b) => a - b),
  };
}

/** Collapse [1,2,3,7,9,10] into "1-3,7,9-10" for target_pages / logging. */
function formatPageRanges(pageNums: number[]): string {
  const sorted = [...new Set(pageNums)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(",");
}

/**
 * Map page numbers as returned by a target_pages parse back to document pages.
 *
 * The API is not explicit about whether a targeted parse preserves original
 * page numbers or renumbers from 1, so infer it: if every number it gave back
 * is one we asked for, take it at face value; otherwise it renumbered, and the
 * i-th page returned corresponds to the i-th page we requested.
 */
function makePageRemap(
  returned: number[],
  targets: number[] | null,
): (n: number) => number {
  if (!targets) return (n) => n;

  const targetSet = new Set(targets);
  if (returned.every((n) => targetSet.has(n))) return (n) => n;

  const sortedTargets = [...targets].sort((a, b) => a - b);
  const sortedReturned = [...new Set(returned)].sort((a, b) => a - b);
  const remap = new Map<number, number>();
  sortedReturned.forEach((n, i) => {
    if (i < sortedTargets.length) remap.set(n, sortedTargets[i]);
  });
  return (n) => remap.get(n) ?? n;
}

// --- LlamaCloud Parse ---

let llamaClient: import("@llamaindex/llama-cloud").LlamaCloud | null = null;

async function getLlamaClient() {
  if (!llamaClient) {
    if (!process.env.LLAMA_CLOUD_API_KEY) {
      throw new Error(
        "LLAMA_CLOUD_API_KEY is not set — required to parse with LlamaParse",
      );
    }
    const { LlamaCloud } = await import("@llamaindex/llama-cloud");
    llamaClient = new LlamaCloud();
  }
  return llamaClient;
}

// Shape of the granular-bbox JSONL sidecar (one JSON object per line, one per page).
interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface GroundedWord {
  span?: [number, number];
  bbox?: Bbox;
}
interface GroundedLine {
  span?: [number, number];
  bbox?: Bbox;
  words?: GroundedWord[];
}
interface GroundedTableCell {
  span?: [number, number];
  lines?: GroundedLine[];
  bbox?: Bbox[];
}
interface Grounding {
  source?: string;
  lines?: GroundedLine[];
  rows?: (GroundedTableCell | null)[][];
}
interface SidecarItem {
  type?: string;
  md?: string;
  // Item-level bbox is a single object for text items but an array for tables.
  bbox?: Bbox | Bbox[];
  grounding?: Grounding;
}
interface SidecarPage {
  page_number: number;
  page_width?: number;
  page_height?: number;
  success: boolean;
  error?: string;
  items?: SidecarItem[];
}

/**
 * Parse with LlamaParse. When `targetPages` is given (1-based document page
 * numbers), only those pages are sent — this is what auto mode uses to pay for
 * the hard pages only. Returned pages are always keyed by document page number.
 */
async function parseWithLlamaParse(
  filePath: string,
  targetPages?: number[],
): Promise<PageData[]> {
  const client = await getLlamaClient();
  const targets = targetPages?.length
    ? [...new Set(targetPages)].sort((a, b) => a - b)
    : null;

  console.log("Uploading file to LlamaCloud Parse...");
  const job = await client.parsing.create({
    tier: "cost_effective",
    version: "latest",
    upload_file: fs.createReadStream(filePath),
    // "cell" is needed too: table items can come back with an empty item-level
    // bbox, and per-cell boxes (only produced when "cell" is requested) are
    // what unionCellBboxes falls back on.
    output_options: { granular_bboxes: ["word", "cell"] },
    ...(targets ? { page_ranges: { target_pages: formatPageRanges(targets) } } : {}),
  });
  console.log(`Job created with ID ${job.id}, waiting for completion...`);
  const result = await client.parsing.waitForCompletion(job.id, { expand: ["items", "text"] });
  console.log("Parse complete!");

  // Granular bboxes live in a separate JSONL sidecar linked via a presigned URL.
  const sidecar = result.result_content_metadata?.["grounded_items"];
  if (!sidecar?.presigned_url) {
    throw new Error(
      "LlamaParse returned no grounded_items sidecar — granular bboxes unavailable",
    );
  }

  const res = await fetch(sidecar.presigned_url);
  if (!res.ok) {
    throw new Error(`Failed to download grounding sidecar: ${res.status}`);
  }
  const body = await res.text();
  const sidecarPages: SidecarPage[] = body
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

  // A targeted parse may renumber its pages from 1; resolve back to document
  // page numbers before anything downstream keys off pageNum.
  const toDocPage = makePageRemap(
    sidecarPages.map((p) => p.page_number),
    targets,
  );

  // Plain text per page (for keyword search / snippets).
  const textByPage = new Map<number, string>();
  for (const tp of result.text?.pages ?? []) {
    textByPage.set(toDocPage(tp.page_number), tp.text ?? "");
  }

  return sidecarPages.map((page) => {
    const pageNum = toDocPage(page.page_number);
    const textItems = page.success ? extractTextItems(page.items ?? []) : [];
    return {
      pageNum,
      width: page.page_width ?? 0,
      height: page.page_height ?? 0,
      text: textByPage.get(pageNum) ?? textItems.map((t) => t.text).join(" "),
      textItems,
    };
  });
}

/**
 * Flatten a page's grounded items into per-word textItems.
 * Word spans index into item.md, so md.slice(span) recovers the exact source
 * text for each box. Tables don't expose per-word source text, so each table
 * collapses to a single coarse box covering the whole table item.
 */
function extractTextItems(items: SidecarItem[]): PageData["textItems"] {
  const out: PageData["textItems"] = [];

  for (const item of items) {
    const md = typeof item.md === "string" ? item.md : "";
    const g = item.grounding;

    if (g?.lines) {
      for (const line of g.lines) {
        const words = line.words ?? [];
        if (words.length > 0) {
          for (const w of words) {
            if (isValidBbox(w.bbox))
              out.push(toTextItem(slice(md, w.span), w.bbox));
          }
        } else if (isValidBbox(line.bbox)) {
          out.push(toTextItem(slice(md, line.span), line.bbox));
        }
      }
    } else if (g?.rows) {
      // Emit per-word items from cell grounding so citations inside tables
      // resolve to tight boxes instead of the whole table.
      const emitted = emitTableCells(md, g.rows, out);
      if (!emitted) {
        const bbox = firstValidBbox(item.bbox) ?? unionCellBboxes(g.rows);
        if (bbox) out.push(toTextItem(stripTableMd(md), bbox));
      }
    } else {
      const bbox = firstValidBbox(item.bbox);
      if (bbox) out.push(toTextItem(md, bbox));
    }
  }

  return out;
}

/**
 * Cell spans index into the cell's own text, which is not carried in the
 * sidecar — recover it by parsing the markdown table grid. Grid rows align
 * 1:1 with grounding rows (header included; separator row excluded).
 */
function parseMdTableGrid(md: string): string[][] {
  return md
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .filter((l) => !/^\s*\|[\s\-:|]+\|\s*$/.test(l))
    .map((l) =>
      l
        .replace(/^\s*\||\|\s*$/g, "")
        .split("|")
        .map((c) => c.trim()),
    );
}

function emitTableCells(
  md: string,
  rows: (GroundedTableCell | null)[][],
  out: PageData["textItems"],
): boolean {
  const grid = parseMdTableGrid(md);
  let emitted = false;

  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell) return;
      const cellText = grid[r]?.[c] ?? "";

      const lines = cell.lines ?? [];
      if (lines.length > 0) {
        for (const line of lines) {
          const words = line.words ?? [];
          if (words.length > 0) {
            for (const w of words) {
              if (isValidBbox(w.bbox)) {
                out.push(toTextItem(slice(cellText, w.span), w.bbox));
                emitted = true;
              }
            }
          } else if (isValidBbox(line.bbox)) {
            out.push(toTextItem(slice(cellText, line.span), line.bbox));
            emitted = true;
          }
        }
      } else {
        const b = (cell.bbox ?? []).find(isValidBbox);
        if (b && cellText) {
          out.push(toTextItem(cellText, b));
          emitted = true;
        }
      }
    }),
  );

  return emitted;
}

function firstValidBbox(b?: Bbox | Bbox[]): Bbox | null {
  const arr = Array.isArray(b) ? b : b ? [b] : [];
  return arr.find(isValidBbox) ?? null;
}

function isValidBbox(b?: Bbox): b is Bbox {
  return (
    !!b &&
    typeof b.x === "number" &&
    typeof b.y === "number" &&
    typeof b.w === "number" &&
    typeof b.h === "number"
  );
}

function unionCellBboxes(rows: (GroundedTableCell | null)[][]): Bbox | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const row of rows) {
    for (const cell of row) {
      for (const b of cell?.bbox ?? []) {
        if (!isValidBbox(b)) continue;
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function slice(md: string, span?: [number, number]): string {
  if (!span) return "";
  return md.slice(span[0], span[1]);
}

function toTextItem(
  text: string,
  b: Bbox,
): PageData["textItems"][number] {
  return { text, x: b.x, y: b.y, width: b.w, height: b.h };
}

function stripTableMd(md: string): string {
  return md
    .replace(/\|/g, " ")
    .replace(/-{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
