import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { addDocument, DOCS_DIR } from "@/lib/store";
import { ingestPdf, type ParserType } from "@/lib/ingest";
import puppeteer from "puppeteer";

const USER_AGENT = "LiteParse-Demo demo@liteparse.dev";
const SEC_HEADERS = { "User-Agent": USER_AGENT, Accept: "application/json" };

// SEC rate-limits aggressively, so all EDGAR downloads are serialized through
// this queue. Parsing happens outside the queue, so concurrent requests parse
// in parallel while the next download proceeds.
let secQueue: Promise<unknown> = Promise.resolve();

function withSecQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = secQueue.then(fn, fn);
  secQueue = run.catch(() => {});
  return run;
}

interface Filing {
  accessionNumber: string;
  filingDate: string;
  form: string;
  primaryDocument: string;
  primaryDocDescription: string;
}

/**
 * GET /api/edgar?ticker=AAPL&form=10-K
 * Search SEC EDGAR for recent filings by ticker.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker")?.toUpperCase();
  const formFilter = searchParams.get("form") || "10-K,10-Q";

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  try {
    // Step 1: Resolve ticker → CIK
    const cik = await resolveCik(ticker);
    if (!cik) {
      return NextResponse.json(
        { error: `Ticker "${ticker}" not found in SEC database` },
        { status: 404 },
      );
    }

    // Step 2: Get recent filings
    const filings = await getFilings(cik, formFilter);

    return NextResponse.json({ ticker, cik, filings });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "EDGAR lookup failed" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/edgar { ticker, accessionNumber, primaryDocument, form, filingDate }
 * Download and ingest a specific filing.
 */
export async function POST(req: Request) {
  const { ticker, accessionNumber, primaryDocument, form, filingDate, parser } =
    await req.json();
  const parserType: ParserType =
    parser === "llamaparse" ? "llamaparse" : "liteparse";

  if (!ticker || !accessionNumber || !primaryDocument) {
    return NextResponse.json(
      { error: "ticker, accessionNumber, and primaryDocument are required" },
      { status: 400 },
    );
  }

  try {
    const downloaded = await withSecQueue(() =>
      downloadFiling(ticker, accessionNumber, primaryDocument),
    );
    if (!downloaded) {
      return NextResponse.json(
        { error: `Ticker "${ticker}" not found` },
        { status: 404 },
      );
    }

    const filename = `${ticker.toLowerCase()}-${form?.toLowerCase() || "filing"}-${filingDate || accessionNumber}.pdf`;
    return await saveAndIngest(filename, downloaded, parserType);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Download failed" },
      { status: 500 },
    );
  }
}

/** Download a filing as a PDF buffer. Returns null if the ticker is unknown. */
async function downloadFiling(
  ticker: string,
  accessionNumber: string,
  primaryDocument: string,
): Promise<Buffer | null> {
  const cik = await resolveCik(ticker.toUpperCase());
  if (!cik) return null;

  const accessionClean = accessionNumber.replace(/-/g, "");
  const docUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionClean}/${primaryDocument}`;

  const res = await fetch(docUrl, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Failed to download filing: ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const isPdf =
    contentType.includes("pdf") ||
    primaryDocument.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    return Buffer.from(await res.arrayBuffer());
  }

  // Not a PDF — try to find a PDF version in the filing index
  const pdfUrl = await findPdfInFiling(cik, accessionNumber);
  if (pdfUrl) {
    const pdfRes = await fetch(pdfUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (pdfRes.ok) {
      return Buffer.from(await pdfRes.arrayBuffer());
    }
  }

  // Fallback: convert HTML to PDF via Puppeteer.
  return htmlToPdf(docUrl);
}

async function saveAndIngest(
  filename: string,
  buffer: Buffer,
  parserType: ParserType,
): Promise<NextResponse> {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  const filePath = path.join(DOCS_DIR, filename);
  fs.writeFileSync(filePath, buffer);

  try {
    const doc = await ingestPdf(filePath, filename, parserType);
    addDocument(doc);
    return NextResponse.json({
      filename: doc.filename,
      pageCount: doc.pages.length,
    });
  } catch (e) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw e;
  }
}

// --- SEC EDGAR helpers ---

let cikCache: Record<string, string> | null = null;

async function resolveCik(ticker: string): Promise<string | null> {
  if (!cikCache) {
    const res = await fetch(
      "https://www.sec.gov/files/company_tickers.json",
      { headers: SEC_HEADERS },
    );
    if (!res.ok) throw new Error("Failed to fetch SEC ticker list");
    const data = await res.json();
    cikCache = {};
    for (const entry of Object.values(data) as Array<{
      cik_str: number;
      ticker: string;
    }>) {
      cikCache[entry.ticker] = String(entry.cik_str);
    }
  }
  return cikCache[ticker] || null;
}

async function getFilings(
  cik: string,
  formFilter: string,
): Promise<Filing[]> {
  const paddedCik = cik.padStart(10, "0");
  const res = await fetch(
    `https://data.sec.gov/submissions/CIK${paddedCik}.json`,
    { headers: SEC_HEADERS },
  );
  if (!res.ok) throw new Error(`Failed to fetch submissions: ${res.status}`);
  const data = await res.json();

  const recent = data.filings?.recent;
  if (!recent) return [];

  const forms = formFilter.split(",").map((f) => f.trim().toUpperCase());
  const filings: Filing[] = [];

  for (let i = 0; i < recent.form.length && filings.length < 20; i++) {
    if (!forms.includes(recent.form[i])) continue;
    filings.push({
      accessionNumber: recent.accessionNumber[i],
      filingDate: recent.filingDate[i],
      form: recent.form[i],
      primaryDocument: recent.primaryDocument[i],
      primaryDocDescription: recent.primaryDocDescription?.[i] || "",
    });
  }

  return filings;
}

/**
 * Convert an HTML page to PDF using Puppeteer (headless Chrome).
 * Navigates to the URL directly so relative assets/styles load correctly.
 */
async function htmlToPdf(url: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function findPdfInFiling(
  cik: string,
  accessionNumber: string,
): Promise<string | null> {
  const accessionClean = accessionNumber.replace(/-/g, "");
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionClean}/${accessionNumber}-index.htm`;

  try {
    const res = await fetch(indexUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Look for PDF links in the filing index
    const pdfMatch = html.match(
      /href="([^"]+\.pdf)"/i,
    );
    if (pdfMatch) {
      const href = pdfMatch[1];
      if (href.startsWith("http")) return href;
      return `https://www.sec.gov${href.startsWith("/") ? "" : `/Archives/edgar/data/${cik}/${accessionClean}/`}${href}`;
    }
  } catch {
    // ignore
  }
  return null;
}
