import { LiteParse } from "@llamaindex/liteparse";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { DOCS_DIR } from "@/lib/store";

let screenshotParser: LiteParse | null = null;

function getParser() {
  if (!screenshotParser) {
    screenshotParser = new LiteParse({ dpi: 150 });
  }
  return screenshotParser;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string; page: string }> },
) {
  const { filename, page } = await params;
  const pageNum = parseInt(page, 10);

  if (isNaN(pageNum) || pageNum < 1) {
    return NextResponse.json({ error: "Invalid page number" }, { status: 400 });
  }

  const safeName = path.basename(filename);
  const filePath = path.join(DOCS_DIR, safeName);

  try {
    const parser = getParser();
    const screenshots = await parser.screenshot(filePath, [pageNum]);

    if (screenshots.length === 0) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const shot = screenshots[0];
    return new NextResponse(new Uint8Array(shot.imageBuffer), {
      headers: {
        "Content-Type": "image/png",
        "X-Page-Width": String(shot.width),
        "X-Page-Height": String(shot.height),
        "X-Scale-Factor": String(150 / 72),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
