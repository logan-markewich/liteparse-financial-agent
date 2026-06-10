/**
 * Simple in-memory document store with keyword search.
 * Loaded from the JSON file produced by ingest.ts.
 * Supports dynamic addition of documents at runtime.
 */
import fs from "fs";
import path from "path";
import { searchItems } from "@llamaindex/liteparse";

const STORE_PATH = path.resolve(process.cwd(), "store.json");
export const DOCS_DIR = path.resolve(process.cwd(), "downloaded_docs");

export interface PageData {
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
}

export interface Document {
  filename: string;
  pages: PageData[];
}

export interface SearchResult {
  filename: string;
  pageNum: number;
  snippet: string;
}

export interface TextLocation {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

let documents: Document[] | null = null;

export function loadStore(): Document[] {
  if (documents) return documents;
  if (fs.existsSync(STORE_PATH)) {
    documents = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } else {
    documents = [];
  }
  return documents!;
}

/**
 * Add a parsed document to the in-memory store and persist to disk.
 * Replaces any existing document with the same filename.
 */
export function addDocument(doc: Document): void {
  const docs = loadStore();
  const existing = docs.findIndex((d) => d.filename === doc.filename);
  if (existing >= 0) {
    docs[existing] = doc;
  } else {
    docs.push(doc);
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(docs, null, 2));
}

/**
 * Remove a document from the store by filename.
 */
export function removeDocument(filename: string): boolean {
  const docs = loadStore();
  const idx = docs.findIndex((d) => d.filename === filename);
  if (idx < 0) return false;
  docs.splice(idx, 1);
  fs.writeFileSync(STORE_PATH, JSON.stringify(docs, null, 2));
  return true;
}

/**
 * Search across all documents for pages containing the query.
 * Supports plain keyword search (space-separated terms) or regex patterns
 * (when `useRegex` is true).
 */
/**
 * Convert a simple glob pattern (with * and ?) into a RegExp.
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const re = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`, "i");
}

export function searchDocuments(
  query: string,
  maxResults: number = 5,
  useRegex: boolean = false,
  fileGlob?: string,
): SearchResult[] {
  let docs = loadStore();
  if (fileGlob) {
    const globRe = globToRegExp(fileGlob);
    docs = docs.filter((d) => globRe.test(d.filename));
  }
  const results: Array<SearchResult & { score: number }> = [];

  if (useRegex) {
    let re: RegExp;
    try {
      re = new RegExp(query, "gi");
    } catch {
      return []; // invalid regex — return empty
    }

    for (const doc of docs) {
      for (const page of doc.pages) {
        const matches = [...page.text.matchAll(re)];
        if (matches.length === 0) continue;

        const firstIdx = matches[0].index ?? 0;
        const snippetStart = Math.max(0, firstIdx - 1000);
        const snippetEnd = Math.min(page.text.length, firstIdx + 1000);
        const snippet =
          (snippetStart > 0 ? "..." : "") +
          page.text.slice(snippetStart, snippetEnd).trim() +
          (snippetEnd < page.text.length ? "..." : "");

        results.push({
          filename: doc.filename,
          pageNum: page.pageNum,
          snippet,
          score: matches.length,
        });
      }
    }
  } else {
    const terms = query.toLowerCase().split(/\s+/);

    for (const doc of docs) {
      for (const page of doc.pages) {
        const textLower = page.text.toLowerCase();
        const score = terms.filter((t) => textLower.includes(t)).length;
        if (score === 0) continue;

        const firstTermIdx = Math.min(
          ...terms
            .map((t) => textLower.indexOf(t))
            .filter((i) => i >= 0),
        );
        const snippetStart = Math.max(0, firstTermIdx - 1000);
        const snippetEnd = Math.min(page.text.length, firstTermIdx + 1000);
        const snippet =
          (snippetStart > 0 ? "..." : "") +
          page.text.slice(snippetStart, snippetEnd).trim() +
          (snippetEnd < page.text.length ? "..." : "");

        results.push({
          filename: doc.filename,
          pageNum: page.pageNum,
          snippet,
          score,
        });
      }
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ score: _score, ...rest }) => rest);
}

/**
 * Get the full text of a specific page in a document.
 */
export function getPage(
  filename: string,
  pageNum: number,
): { text: string; textItems: PageData["textItems"] } | null {
  const docs = loadStore();
  const doc = docs.find((d) => d.filename === filename);
  if (!doc) return null;
  const page = doc.pages.find((p) => p.pageNum === pageNum);
  if (!page) return null;
  return { text: page.text, textItems: page.textItems };
}

/**
 * List all documents and their page counts.
 */
export function listDocuments(): Array<{
  filename: string;
  pageCount: number;
}> {
  const docs = loadStore();
  return docs.map((d) => ({ filename: d.filename, pageCount: d.pages.length }));
}

/**
 * Find the bounding box location of a text phrase on a specific page.
 * Used by the /api/cite endpoint to resolve citations from <cite> tags.
 *
 * Strategy:
 * 1. Try LiteParse's searchItems for exact spatial-aware matching
 * 2. Fallback: try progressively looser normalizations with whitespace-flexible
 *    regex matching (original → currency-stripped → alphanumeric-only)
 * 3. Last resort: try matching the longest significant token from the phrase
 */

/** Strip everything except letters and digits */
function alphanumOnly(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface ItemSpan {
  item: PageData["textItems"][number];
  startOffset: number; // char offset in the concatenated string
  endOffset: number;
}

/**
 * Build a concatenated text string from textItems along with a mapping
 * from character offsets back to items.
 */
function buildTextMap(textItems: PageData["textItems"]): {
  text: string;
  spans: ItemSpan[];
} {
  let text = "";
  const spans: ItemSpan[] = [];
  for (const item of textItems) {
    const start = text.length;
    text += item.text;
    spans.push({ item, startOffset: start, endOffset: text.length });
  }
  return { text, spans };
}

/**
 * Given a character range [matchStart, matchEnd) in the concatenated text,
 * find the textItems that overlap and compute their bounding box.
 */
function bboxFromRange(
  spans: ItemSpan[],
  matchStart: number,
  matchEnd: number,
): TextLocation | null {
  const overlapping = spans.filter(
    (s) => s.endOffset > matchStart && s.startOffset < matchEnd,
  );
  if (overlapping.length === 0) return null;

  // For each overlapping item, estimate the sub-region that actually
  // corresponds to the matched characters (proportional to char count).
  const rects = overlapping.map((s) => {
    const itemLen = s.endOffset - s.startOffset;
    if (itemLen <= 0) return { x: s.item.x, w: s.item.width };

    const overlapStart = Math.max(matchStart, s.startOffset);
    const overlapEnd = Math.min(matchEnd, s.endOffset);
    const fracStart = (overlapStart - s.startOffset) / itemLen;
    const fracEnd = (overlapEnd - s.startOffset) / itemLen;

    return {
      x: s.item.x + s.item.width * fracStart,
      w: s.item.width * (fracEnd - fracStart),
    };
  });

  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const minY = Math.min(...overlapping.map((s) => s.item.y));
  const maxH = Math.max(...overlapping.map((s) => s.item.height));

  return {
    text: overlapping.map((s) => s.item.text).join(""),
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxH,
  };
}

export function findTextLocation(
  filename: string,
  pageNum: number,
  phrase: string,
): TextLocation[] {
  const page = getPage(filename, pageNum);
  if (!page) return [];

  // Drop items without numeric coordinates (older LlamaParse ingests stored
  // table items with undefined bboxes) — the native searchItems rejects them.
  const textItems = page.textItems.filter(
    (t) =>
      typeof t.x === "number" &&
      typeof t.y === "number" &&
      typeof t.width === "number" &&
      typeof t.height === "number",
  );
  if (textItems.length === 0) return [];

  // --- Strategy 1: use LiteParse's searchItems for proper cross-line matching ---
  // searchItems handles item concatenation with spatial awareness and returns
  // merged bounding boxes that span multiple text items correctly.
  const matches = searchItems(textItems, { phrase, caseSensitive: false });
  console.log("searchItems matches for query", phrase, matches);
  if (matches.length > 0) {
    return matches.slice(0, 3).map((m) => ({
      text: m.text,
      x: m.x,
      y: m.y,
      width: m.width,
      height: m.height,
    }));
  }

  // --- Fallback strategies using the raw concatenated text from textItems ---
  const { text: rawText, spans } = buildTextMap(textItems);

  // Build a whitespace-flexible regex from a string: each non-whitespace char
  // is escaped and joined with \s* so any amount of whitespace is tolerated.
  function flexMatch(candidate: string): TextLocation | null {
    const chars = [...candidate].filter((ch) => ch.trim().length > 0);
    if (chars.length === 0) return null;
    const pattern = chars
      .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*");
    try {
      const match = new RegExp(pattern, "gi").exec(rawText);
      if (match) {
        return bboxFromRange(spans, match.index, match.index + match[0].length);
      }
    } catch {
      // invalid regex — fall through
    }
    return null;
  }

  // Try progressively looser normalizations of the phrase:
  // 1. Original phrase (whitespace-flexible)
  // 2. Currency/symbols stripped (keeps digits, commas, periods, %, -)
  // 3. Alphanumeric only (letters + digits)
  const candidates = [
    phrase,
    phrase.replace(/[^0-9.,%\s-]/g, "").trim(),
    alphanumOnly(phrase),
  ];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const loc = flexMatch(candidate);
    if (loc) return [loc];
  }

  // --- Last resort: try the longest significant token (partial match) ---
  // e.g. "$416,161 million" → try "416,161" alone
  const tokens = phrase.match(/[\d][,.\d]+[\d]|[a-zA-Z]{4,}/g);
  if (tokens) {
    tokens.sort((a, b) => b.length - a.length);
    for (const token of tokens.slice(0, 3)) {
      if (token.length < 4) continue;
      const loc = flexMatch(token);
      if (loc) return [loc];
    }
  }

  return [];
}

