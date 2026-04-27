/**
 * Ingest: Parse all PDFs in ../docs/ with LiteParse and save results to a local JSON store.
 * Run with: npm run ingest
 */
import { LiteParse } from "@llamaindex/liteparse";
import fs from "fs";
import path from "path";

const DOCS_DIR = path.resolve(import.meta.dirname, "../../docs");
const STORE_PATH = path.resolve(import.meta.dirname, "../store.json");

interface StoredDocument {
  filename: string;
  pages: Array<{
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
  }>;
}

async function main() {
  const files = fs
    .readdirSync(DOCS_DIR)
    .filter((f) => f.endsWith(".pdf"))
    .sort();

  if (files.length === 0) {
    console.error("No PDF files found in", DOCS_DIR);
    process.exit(1);
  }

  console.log(`Found ${files.length} PDFs to ingest:\n`);
  files.forEach((f) => console.log(`  - ${f}`));
  console.log();

  const parser = new LiteParse({
    outputFormat: "json",
    ocrEnabled: false, // SEC filings are native text PDFs
  });

  const documents: StoredDocument[] = [];

  for (const file of files) {
    const filePath = path.join(DOCS_DIR, file);
    console.log(`Parsing ${file}...`);

    const start = performance.now();
    const result = await parser.parse(filePath, true);
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    const pages =
      result.json?.pages.map((p) => ({
        pageNum: p.page,
        width: p.width,
        height: p.height,
        text: p.text,
        textItems: p.textItems.map((item) => ({
          text: item.text,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          fontName: item.fontName,
          fontSize: item.fontSize,
        })),
      })) ?? [];

    documents.push({ filename: file, pages });
    console.log(
      `  → ${pages.length} pages parsed in ${elapsed}s (${pages.reduce((sum, p) => sum + p.textItems.length, 0)} text items)\n`,
    );
  }

  fs.writeFileSync(STORE_PATH, JSON.stringify(documents, null, 2));
  console.log(`Store saved to ${STORE_PATH}`);
  console.log(
    `Total: ${documents.length} documents, ${documents.reduce((s, d) => s + d.pages.length, 0)} pages`,
  );
}

main().catch(console.error);
