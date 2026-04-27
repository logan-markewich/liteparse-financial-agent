/**
 * Simple in-memory document store with keyword search.
 * Loaded from the JSON file produced by ingest.ts.
 * Supports dynamic addition of documents at runtime.
 */
import fs from "fs";
import path from "path";

const STORE_PATH = path.resolve(process.cwd(), "store.json");
export const DOCS_DIR = path.resolve(process.cwd(), "..", "docs");

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
export function searchDocuments(
  query: string,
  maxResults: number = 5,
  useRegex: boolean = false,
): SearchResult[] {
  const docs = loadStore();
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
        const snippetStart = Math.max(0, firstIdx - 200);
        const snippetEnd = Math.min(page.text.length, firstIdx + 600);
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
        const snippetStart = Math.max(0, firstTermIdx - 200);
        const snippetEnd = Math.min(page.text.length, firstTermIdx + 600);
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
 * 1. Build a character-offset map from the concatenated textItems
 * 2. Search using progressively fuzzier matching (exact → normalized → alphanumeric-only)
 * 3. Map matched character range back to the originating textItems
 * 4. Compute bounding box from only the overlapping items
 */

/** Collapse whitespace runs to a single space */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

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

  const minX = Math.min(...overlapping.map((s) => s.item.x));
  const minY = Math.min(...overlapping.map((s) => s.item.y));
  const maxX = Math.max(...overlapping.map((s) => s.item.x + s.item.width));
  const maxH = Math.max(...overlapping.map((s) => s.item.height));

  return {
    text: overlapping.map((s) => s.item.text).join(""),
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxH,
  };
}

/**
 * Search for `needle` in `haystack` and return all match start indices.
 */
function findAllOccurrences(haystack: string, needle: string): number[] {
  const indices: number[] = [];
  let pos = 0;
  while (pos <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, pos);
    if (idx < 0) break;
    indices.push(idx);
    pos = idx + 1;
  }
  return indices;
}

export function findTextLocation(
  filename: string,
  pageNum: number,
  phrase: string,
): TextLocation[] {
  const page = getPage(filename, pageNum);
  if (!page || page.textItems.length === 0) return [];

  const { text: rawText, spans } = buildTextMap(page.textItems);

  // --- Strategy 1: exact normalized match on concatenated textItems ---
  const normText = normalize(rawText);
  const normPhrase = normalize(phrase);
  if (normPhrase.length > 0) {
    const hits = findAllOccurrences(normText, normPhrase);
    if (hits.length > 0) {
      // Map normalized offsets back to raw offsets.
      // Build a mapping: normText[ni] came from rawText[rawIdx[ni]]
      const rawIdx = buildNormToRawMap(rawText);
      const results: TextLocation[] = [];
      for (const hit of hits.slice(0, 3)) {
        const rawStart = rawIdx[hit];
        const rawEnd = rawIdx[hit + normPhrase.length - 1] + 1;
        const loc = bboxFromRange(spans, rawStart, rawEnd);
        if (loc) results.push(loc);
      }
      if (results.length > 0) return results;
    }
  }

  // --- Strategy 2: alphanumeric-only match (handles $, %, commas, dashes) ---
  const alnumText = alphanumOnly(rawText);
  const alnumPhrase = alphanumOnly(phrase);
  if (alnumPhrase.length > 0) {
    const alnumRawMap = buildAlnumToRawMap(rawText);
    const hits = findAllOccurrences(alnumText, alnumPhrase);
    if (hits.length > 0) {
      const results: TextLocation[] = [];
      for (const hit of hits.slice(0, 3)) {
        const rawStart = alnumRawMap[hit];
        const rawEnd = alnumRawMap[hit + alnumPhrase.length - 1] + 1;
        const loc = bboxFromRange(spans, rawStart, rawEnd);
        if (loc) results.push(loc);
      }
      if (results.length > 0) return results;
    }
  }

  // --- Strategy 3: try the longest significant token (for partial matches) ---
  // e.g. "$416,161 million" → try "416,161" alone
  const tokens = phrase.match(/[\d][,.\d]+[\d]|[a-zA-Z]{4,}/g);
  if (tokens) {
    // Sort by length descending, try the longest first
    tokens.sort((a, b) => b.length - a.length);
    for (const token of tokens.slice(0, 3)) {
      const tokenNorm = normalize(token);
      const hits = findAllOccurrences(normText, tokenNorm);
      if (hits.length > 0) {
        const rawIdx = buildNormToRawMap(rawText);
        const rawStart = rawIdx[hits[0]];
        const rawEnd = rawIdx[hits[0] + tokenNorm.length - 1] + 1;
        const loc = bboxFromRange(spans, rawStart, rawEnd);
        if (loc) return [loc];
      }
    }
  }

  return [];
}

/**
 * Build a mapping from normalized-string index → raw-string index.
 * normalize() lowercases and collapses whitespace runs to single spaces.
 */
function buildNormToRawMap(raw: string): number[] {
  const map: number[] = [];
  let inSpace = false;
  let started = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (started && !inSpace) {
        map.push(i); // the single space
        inSpace = true;
      }
    } else {
      if (!started) started = true;
      inSpace = false;
      map.push(i);
    }
  }
  return map;
}

/**
 * Build a mapping from alphanumeric-only index → raw-string index.
 */
function buildAlnumToRawMap(raw: string): number[] {
  const map: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (/[a-zA-Z0-9]/.test(raw[i])) {
      map.push(i);
    }
  }
  return map;
}
