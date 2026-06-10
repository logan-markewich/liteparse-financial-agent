/**
 * Runtime document ingestion.
 * Supports two parsers, selectable per-document:
 *  - "liteparse"  — local, in-process parsing via @llamaindex/liteparse
 *  - "llamaparse" — LlamaCloud Parse API with granular (word-level) bounding boxes
 * Both produce the same Document/PageData shape so the rest of the app
 * (search, citation grounding, screenshots) is parser-agnostic.
 */
import fs from "fs";
import { LiteParse } from "@llamaindex/liteparse";
import type { Document, PageData } from "./store";

export type ParserType = "liteparse" | "llamaparse";

let parser: LiteParse | null = null;

function getParser(): LiteParse {
  if (!parser) {
    parser = new LiteParse({
      outputFormat: "json",
      ocrEnabled: false,
    });
  }
  return parser;
}

/**
 * Parse a PDF file and return a Document ready to add to the store.
 */
export async function ingestPdf(
  filePath: string,
  filename: string,
  parserType: ParserType = "liteparse",
): Promise<Document> {
  const pages =
    parserType === "llamaparse"
      ? await parseWithLlamaParse(filePath)
      : await parseWithLiteParse(filePath);

  return { filename, pages };
}

async function parseWithLiteParse(filePath: string): Promise<PageData[]> {
  const p = getParser();
  const result = await p.parse(filePath);

  return result.pages.map((pg) => ({
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
  }));
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

async function parseWithLlamaParse(filePath: string): Promise<PageData[]> {
  const client = await getLlamaClient();
  
  console.log("Uploading file to LlamaCloud Parse...");
  const job = await client.parsing.create({
    tier: "cost_effective",
    version: "latest",
    upload_file: fs.createReadStream(filePath),
    // "cell" is needed too: table items can come back with an empty item-level
    // bbox, and per-cell boxes (only produced when "cell" is requested) are
    // what unionCellBboxes falls back on.
    output_options: { granular_bboxes: ["word", "cell"] },
  });
  console.log(`Job created with ID ${job.id}, waiting for completion...`);
  const result = await client.parsing.waitForCompletion(job.id, { expand: ["items", "text"] });
  console.log("Parse complete!");

  // Plain text per page (for keyword search / snippets).
  const textByPage = new Map<number, string>();
  for (const tp of result.text?.pages ?? []) {
    textByPage.set(tp.page_number, tp.text ?? "");
  }

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

  return sidecarPages.map((page) => {
    const textItems = page.success ? extractTextItems(page.items ?? []) : [];
    return {
      pageNum: page.page_number,
      width: page.page_width ?? 0,
      height: page.page_height ?? 0,
      text:
        textByPage.get(page.page_number) ??
        textItems.map((t) => t.text).join(" "),
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
