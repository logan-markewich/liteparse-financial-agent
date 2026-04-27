# Building a Financial Due Diligence Agent with LiteParse

A demo application that shows how to build an AI-powered financial research agent using [LiteParse](https://www.npmjs.com/package/@llamaindex/liteparse) for document parsing. The agent can ingest SEC filings, search across them, and answer questions with precise, citation-backed responses, made possible by LiteParse's text extraction and bounding box data.

Financial due diligence is one of the most document-heavy workflows in finance. Analysts spend up to 70% of their time on manual data extraction. This means time spent transcribing PDFs into spreadsheets, mapping GL accounts, and reconciling trial balances.

This project demonstrates:
- Basic `LiteParse` usage for PDF text extraction with layout data
- Building a simple document store with keyword search
- Implementing an LLM agent with tools for document retrieval
- A citation system that highlights exact source text in the original PDF using the bounding box coordinates from LiteParse

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Next.js App (Chat UI + Citation Viewer)            │
│                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Chat     │  │ PDF Page     │  │ Document      │  │
│  │ Messages │  │ Viewer with  │  │ Manager       │  │
│  │ + Cites  │  │ Highlights   │  │ (Upload/EDGAR)│  │
│  └────┬─────┘  └──────┬───────┘  └───────┬───────┘  │
│       │               │                  │          │
├───────┴───────────────┴──────────────────┴──────────┤
│  API Routes                                         │
│                                                     │
│  /api/chat        → LLM with tool calling           │
│  /api/upload      → PDF upload + LiteParse ingest   │
│  /api/edgar       → SEC EDGAR fetch + ingest        │
│  /api/cite        → Text location lookup for cites  │
│  /api/screenshot  → LiteParse page screenshots      │
│  /api/documents   → List/delete documents           │
├─────────────────────────────────────────────────────┤
│  Core Library                                       │
│                                                     │
│  lib/ingest.ts  → LiteParse PDF parsing             │
│  lib/store.ts   → Document store + keyword search   │
│  lib/tools.ts   → Vercel AI SDK tool definitions    │
└─────────────────────────────────────────────────────┘
```

## How LiteParse Is Used

LiteParse powers three critical capabilities in this app:

1. Text extraction with layout data: `LiteParse.parse()` extracts every text item from a PDF along with its bounding box coordinates (`x`, `y`, `width`, `height`), font name, and font size. This structured output is what makes the precise citation highlighting in the app possible.

2. Page screenshots: `LiteParse.screenshot()` renders individual PDF pages as PNG images, used in the citation viewer panel so users can see the original document alongside the agent's answers.

3. HTML-to-PDF conversion support: SEC EDGAR filings can be a mix of HTML and PDF. The app uses Puppeteer to convert these to PDF, then parses them with LiteParse. This means the same extraction pipeline works regardless of the original format.

## Agent Tools

The LLM has access to three tools via the [Vercel AI SDK](https://sdk.vercel.ai/docs):

| Tool | Purpose |
|------|---------|
| `list_documents` | See what filings are loaded and their page counts |
| `search_documents` | Keyword or regex search across all documents, returns page snippets |
| `get_page` | Read the full text of a specific page for detailed analysis |

The agent uses these tools autonomously — when you ask a question, it decides which documents to search, which pages to read, and how to synthesize the answer. The system prompt instructs it to use `<cite>` tags with exact source text, which the UI resolves to highlighted bounding boxes on the PDF page.

## Getting Started

### Prerequisites

- Node.js 18+
- An API key for Anthropic or OpenAI

### Setup

```bash
# Install dependencies
npm install

# Configure your API key
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY or OPENAI_API_KEY
```

### Run the App

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). From there you can:
- **Upload PDFs** directly via the document manager
- **Fetch SEC filings** by ticker symbol (e.g., AAPL, MSFT) — the app queries EDGAR, downloads the filing, and ingests it automatically
- **Chat** with the agent and see citations highlighted on the source PDF pages

### Example Questions

Once you have some filings loaded, try:

- *"What was total net revenue for the most recent fiscal year?"*
- *"Compare operating income across the last two annual filings"*
- *"What are the key risk factors mentioned in the 10-K?"*
- *"How much did R&D spending change year over year?"*
- *"Summarize the debt structure from the balance sheet"*

## How Citations Work

When the agent references a specific number or fact, it is prompted to wrap the text in a `<cite>` tag:

```
Revenue was <cite file="aapl-10k-2024.pdf" page="42">394,328</cite> million.
```

The UI then:
1. Parses the `<cite>` tag to extract the filename, page number, and phrase
2. Calls `/api/cite` which uses `findTextLocation()` to match the phrase against the page's text items
3. Computes the bounding box by mapping the matched character range back to the original text items with their coordinates
4. Renders the PDF page via `/api/screenshot` and draws a highlight overlay at the exact location

The matching is fuzzy to account for the LLM's output variability. It tries exact normalized matching first, then alphanumeric-only matching, then falls back to longest-token matching. This processing chain handles the small formatting differences between what the LLM outputs and what's actually in the PDF.

## Project Structure

```
├── app/
│   ├── page.tsx                     # Main chat + citation viewer layout
│   ├── components/
│   │   ├── ChatMessages.tsx         # Message list with cite tag parsing
│   │   ├── ChatInput.tsx            # User input
│   │   ├── CitationViewer.tsx       # PDF page viewer with highlights
│   │   └── DocumentManager.tsx      # Upload / EDGAR fetch UI
│   └── api/
│       ├── chat/route.ts            # Streaming LLM with tool calling
│       ├── upload/route.ts          # PDF upload + ingest
│       ├── edgar/route.ts           # SEC EDGAR search + download
│       ├── cite/route.ts            # Text location resolution
│       ├── documents/route.ts       # Document list/delete
│       └── screenshot/[...]/route.ts # PDF page rendering
├── lib/
│   ├── ingest.ts                    # LiteParse PDF parsing
│   ├── store.ts                     # JSON document store + search
│   └── tools.ts                     # AI agent tool definitions
└── store.json                       # Parsed document data (generated)
```

## Key Design Decisions

- **No vector database** — Uses simple keyword/regex search over extracted text. For financial documents with precise terminology, keyword search is surprisingly effective and avoids the complexity (and hallucination risk) of embedding-based retrieval.
- **JSON store** — Parsed documents are stored as a flat JSON file. Simple, inspectable, no infrastructure required. Works well for demo-scale data.
- **Layout-aware citations** — LiteParse's text item bounding boxes enable the citation system. This is the key differentiator vs. plain text extraction — you can point to exactly where a number appears on the page.
- **EDGAR integration** — Fetching filings directly from SEC EDGAR makes the demo self-contained. No need to manually download PDFs.
