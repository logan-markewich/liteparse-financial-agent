import type { ReactNode } from "react";

export interface Slide {
  title: string;
  kicker?: string;
  content: ReactNode;
  /** Demo prompt shown with Copy / Send buttons */
  prompt?: string;
}

/* --- small building blocks ------------------------------------------- */

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-base leading-relaxed text-zinc-300">
          <span className="mt-0.5 shrink-0 text-zinc-600">&ndash;</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-[13px] leading-relaxed text-zinc-300">
      {children}
    </pre>
  );
}

function Box({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-center text-[13px] font-medium ${
        accent
          ? "border-zinc-500 bg-zinc-800 text-zinc-100"
          : "border-zinc-700 bg-zinc-900 text-zinc-400"
      }`}
    >
      {children}
    </div>
  );
}

function Arrow() {
  return <div className="text-center text-zinc-600">&darr;</div>;
}

function Hi({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-zinc-100">{children}</span>;
}

/* --- the deck ---------------------------------------------------------- */

export const SLIDES: Slide[] = [
  {
    title: "Financial Research Agent",
    kicker: "LiteParse + LlamaParse · SEC Filings",
    content: (
      <div className="space-y-5">
        <Bullets
          items={[
            <>
              An agent that answers questions over SEC filings with{" "}
              <Hi>pixel-level citations</Hi> back to the source PDF
            </>,
            <>
              Built on document parsing with <Hi>bounding boxes</Hi> — every
              word knows where it lives on the page
            </>,
            <>
              No vector database, no embeddings — <Hi>parse, store, search</Hi>
            </>,
            <>Today: ingest pipeline, cited analysis, and how it works inside</>,
          ]}
        />
      </div>
    ),
  },
  {
    title: "Architecture",
    kicker: "From filing to cited answer",
    content: (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            <Box>SEC EDGAR download</Box>
            <Box>PDF upload</Box>
          </div>
          <Arrow />
          <div className="grid grid-cols-2 gap-2">
            <Box accent>LiteParse (local)</Box>
            <Box accent>LlamaParse (cloud)</Box>
          </div>
          <Arrow />
          <Box>
            store.json — text + per-word bounding boxes, per page
          </Box>
          <Arrow />
          <Box>
            agent tools: search_documents &middot; read_page &middot; cite
          </Box>
          <Arrow />
          <div className="grid grid-cols-2 gap-2">
            <Box>chat answer with &lt;cite&gt; tags</Box>
            <Box>viewer with highlight overlays</Box>
          </div>
        </div>
        <Bullets
          items={[
            <>
              Both parsers produce the <Hi>same shape</Hi> — the rest of the
              app is parser-agnostic
            </>,
            <>Keyword search over page text is enough for filings</>,
          ]}
        />
      </div>
    ),
  },
  {
    title: "Demo 1 — Ingest from EDGAR",
    kicker: "Document Manager → SEC EDGAR tab",
    content: (
      <div className="space-y-4">
        <Bullets
          items={[
            <>
              Search <Hi>AAPL</Hi>, filter to 10-K, select the two most recent
              filings, click Add
            </>,
            <>
              SEC rate-limits aggressively — downloads are{" "}
              <Hi>serialized through a queue</Hi> on the server
            </>,
            <>
              Parsing runs <Hi>in parallel</Hi> — filing N+1 downloads while
              filing N parses
            </>,
            <>70–100+ pages per filing, parsed in seconds</>,
          ]}
        />
        <Code>{`// app/api/edgar/route.ts
const downloaded = await withSecQueue(() =>
  downloadFiling(ticker, accession, doc),  // sequential
);
return await saveAndIngest(filename, downloaded, parser); // parallel`}</Code>
      </div>
    ),
  },
  {
    title: "Two Parsers, One Shape",
    kicker: "LiteParse vs LlamaParse",
    content: (
      <div className="space-y-4">
        <Bullets
          items={[
            <>
              <Hi>LiteParse</Hi> — runs in-process, no API calls, native text
              extraction with per-item boxes. Fast and free.
            </>,
            <>
              <Hi>LlamaParse</Hi> — cloud parsing with layout understanding:
              tables, reading order, and <Hi>granular word/cell grounding</Hi>
            </>,
            <>
              Pick per document at ingest time — output is normalized to the
              same <Hi>textItems</Hi> structure
            </>,
          ]}
        />
        <Code>{`// lib/ingest.ts
const pages = parserType === "llamaparse"
  ? await parseWithLlamaParse(filePath)
  : await parseWithLiteParse(filePath);

// both return: { pageNum, width, height, text,
//   textItems: [{ text, x, y, width, height }] }`}</Code>
      </div>
    ),
  },
  {
    title: "Demo 2 — Revenue Trend",
    kicker: "Cross-document analysis with verifiable numbers",
    content: (
      <div className="space-y-4">
        <Bullets
          items={[
            <>
              The agent decides <Hi>which pages to read</Hi> — nobody tells it
              where the income statement is
            </>,
            <>Every number carries a citation — click to see the highlight</>,
            <>
              Follow up with the product vs services breakdown to show it
              digging into the <Hi>disaggregation notes</Hi>
            </>,
          ]}
        />
      </div>
    ),
    prompt:
      "What was Apple's total net revenue for each fiscal year across the loaded filings? Present the results in a markdown table with columns for fiscal year, total net revenue, and year-over-year change.",
  },
  {
    title: "How Citations Work",
    kicker: "From <cite> tag to highlighted pixels",
    content: (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Box>
            model emits &lt;cite file=&quot;...&quot; page=&quot;44&quot;
            phrase=&quot;416,161&quot;&gt;
          </Box>
          <Arrow />
          <Box accent>POST /api/cite → findTextLocation()</Box>
          <Arrow />
          <Box>searchItems: spatial-aware phrase match over textItems</Box>
          <Arrow />
          <Box>bounding box → scaled overlay on the page screenshot</Box>
        </div>
        <Bullets
          items={[
            <>
              Fallback chain: exact match → whitespace-flexible regex →
              currency-stripped → longest token
            </>,
            <>
              If nothing matches, the badge shows <Hi>yellow / unverified</Hi>{" "}
              — honesty beats confident hallucination in finance
            </>,
          ]}
        />
      </div>
    ),
  },
  {
    title: "Granular Bounding Boxes",
    kicker: "Why table citations are word-level",
    content: (
      <div className="space-y-4">
        <Bullets
          items={[
            <>
              LlamaParse returns a <Hi>JSONL grounding sidecar</Hi>: per-word,
              per-line, and per-table-cell boxes
            </>,
            <>
              Cell spans index into the cell&apos;s own text — recovered by
              parsing the markdown table grid
            </>,
            <>
              Result: citing <Hi>&quot;416,161&quot;</Hi> highlights a 32×9pt
              word, not a page-sized table blob
            </>,
          ]}
        />
        <Code>{`// lib/ingest.ts — per-cell word grounding
for (const w of line.words)
  out.push(toTextItem(cellText.slice(...w.span), w.bbox));

// → { text: "416,161", x: 384.6, y: 210.6,
//     width: 32.5, height: 9.0 }`}</Code>
      </div>
    ),
  },
  {
    title: "Demo 3 — Mini Quality of Earnings",
    kicker: "Analytical work, not just extraction",
    content: (
      <div className="space-y-4">
        <Bullets
          items={[
            <>
              Real QoE work: 15–30 discrete adjustments, often reducing
              reported EBITDA by <Hi>10–20%</Hi>
            </>,
            <>
              The least automated part of financial due diligence today — even
              surfacing <Hi>candidate adjustments</Hi> saves analyst hours
            </>,
            <>
              Watch for yellow badges — the system is transparent about what it
              can&apos;t precisely locate
            </>,
          ]}
        />
      </div>
    ),
    prompt:
      "Search for any non-recurring, one-time, or unusual items across the filings that would need to be adjusted in a Quality of Earnings analysis. Look for restructuring charges, litigation, impairments, and other non-operating items. Present findings as a table with columns: item description, fiscal year, amount, and the filing page where it was found.",
  },
  {
    title: "Demo 4 — Debt & Commitments",
    kicker: "Deep navigation into the notes",
    content: (
      <div className="space-y-4">
        <Bullets
          items={[
            <>
              The debt footnote is usually <Hi>50–70 pages</Hi> into the filing
              — the agent finds it without a page number
            </>,
            <>
              The citation viewer shows the original formatted table next to
              the agent&apos;s summary
            </>,
            <>
              Follow-up: &quot;Are there any debt covenants or
              change-of-control provisions mentioned?&quot; — knowing
              something <Hi>isn&apos;t disclosed</Hi> is also diligence work
            </>,
          ]}
        />
      </div>
    ),
    prompt:
      "Summarize Apple's long-term debt obligations. Present the maturity schedule as a table with columns for maturity year/range and amount. Then list any capital lease obligations or purchase commitments in a separate table.",
  },
  {
    title: "Demo 5 — Risk Factor Diff",
    kicker: "Comprehension across documents",
    content: (
      <div className="space-y-4">
        <Bullets
          items={[
            <>
              Diffing risk factors between periods is a real analyst task —
              new risks signal <Hi>what management worries about now</Hi>
            </>,
            <>This demonstrates reasoning, not just number extraction</>,
            <>Both filings get cited, so every claim is verifiable in context</>,
          ]}
        />
      </div>
    ),
    prompt:
      'Compare the risk factors between the two filings. List any new risks added in the more recent filing and any that were removed. Present as two sections — "New Risks" and "Removed Risks" — with a one-sentence summary of each risk and a citation to the relevant page.',
  },
  {
    title: "Demo 6 — Audience Pick",
    kicker: "Any public company, zero to insight in ~60s",
    content: (
      <div className="space-y-4">
        <Bullets
          items={[
            <>Take a ticker from the audience — EDGAR tab, add the latest 10-K</>,
            <>
              Backups: <Hi>MSFT</Hi> &middot; <Hi>GOOGL</Hi> &middot;{" "}
              <Hi>AMZN</Hi>
            </>,
            <>
              No pre-processing, no embeddings — ticker to cited analysis in
              under a minute
            </>,
          ]}
        />
      </div>
    ),
    prompt:
      "Give me a quick financial overview of this company. Present a summary table with: total revenue, net income, total assets, and total debt. Below the table, list any notable items or red flags as bullet points with citations.",
  },
  {
    title: "Wrap-up",
    kicker: "What this is — and what production adds",
    content: (
      <div className="space-y-4">
        <Bullets
          items={[
            <>
              <Hi>Parsing with layout is the foundation</Hi> — citations are
              only as good as the bounding boxes underneath them
            </>,
            <>
              This demo: keyword search + agent tools. Production: vector
              search, more tools, human review workflows
            </>,
            <>
              The pattern generalizes — any document-heavy workflow where
              answers must be <Hi>verifiable</Hi>
            </>,
          ]}
        />
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-base text-zinc-300">
          Questions? Everything shown is in the repo — parsing, grounding,
          citation matching included.
        </div>
      </div>
    ),
  },
];
