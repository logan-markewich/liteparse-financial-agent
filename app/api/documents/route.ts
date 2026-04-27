import { NextResponse } from "next/server";
import { listDocuments, removeDocument } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ documents: listDocuments() });
}

export async function DELETE(req: Request) {
  const { filename } = await req.json();
  if (!filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }
  const removed = removeDocument(filename);
  return NextResponse.json({ removed });
}
