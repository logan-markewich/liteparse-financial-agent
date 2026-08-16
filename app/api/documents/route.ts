import { NextResponse } from "next/server";
import { listDocuments, removeDocument } from "@/lib/store";
import { isAutoAvailable } from "@/lib/ingest";

export async function GET() {
  // autoAvailable gates the "Auto" parser option in the UI — it needs a
  // LlamaCloud key to upgrade pages.
  return NextResponse.json({
    documents: listDocuments(),
    autoAvailable: isAutoAvailable(),
  });
}

export async function DELETE(req: Request) {
  const { filename } = await req.json();
  if (!filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }
  const removed = removeDocument(filename);
  return NextResponse.json({ removed });
}
