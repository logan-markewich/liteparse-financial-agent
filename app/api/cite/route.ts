import { NextResponse } from "next/server";
import { findTextLocation } from "@/lib/store";

export async function POST(req: Request) {
  const { filename, pageNumber, phrase } = await req.json();

  if (!filename || !pageNumber || !phrase) {
    return NextResponse.json(
      { error: "Missing filename, pageNumber, or phrase" },
      { status: 400 },
    );
  }

  const locations = findTextLocation(filename, pageNumber, phrase);

  return NextResponse.json({ filename, pageNumber, phrase, locations });
}
