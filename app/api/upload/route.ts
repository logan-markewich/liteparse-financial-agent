import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { addDocument, DOCS_DIR } from "@/lib/store";
import { ingestPdf, type ParserType } from "@/lib/ingest";

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const parser: ParserType =
    formData.get("parser") === "llamaparse" ? "llamaparse" : "liteparse";

  if (!file || !file.name.endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Please upload a PDF file" },
      { status: 400 },
    );
  }

  // Ensure docs directory exists
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  // Save the uploaded file
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(DOCS_DIR, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  try {
    const doc = await ingestPdf(filePath, filename, parser);
    addDocument(doc);

    return NextResponse.json({
      filename: doc.filename,
      pageCount: doc.pages.length,
    });
  } catch (e) {
    // Clean up on failure
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to parse PDF" },
      { status: 500 },
    );
  }
}
