/**
 * Runtime document ingestion using LiteParse.
 * Used by /api/upload and /api/edgar to parse PDFs on the fly.
 */
import { LiteParse } from "@llamaindex/liteparse";
import type { Document } from "./store";

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
): Promise<Document> {
  const p = getParser();
  const result = await p.parse(filePath, true);

  const pages =
    result.json?.pages.map((pg) => ({
      pageNum: pg.page,
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
    })) ?? [];

  return { filename, pages };
}
