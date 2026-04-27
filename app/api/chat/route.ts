import {
  streamText,
  smoothStream,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { tools } from "@/lib/tools";
import { listDocuments } from "@/lib/store";

const provider = process.env.AI_PROVIDER || "anthropic";

function getModel() {
  switch (provider) {
    case "openai":
      return openai("gpt-4o");
    case "anthropic":
    default:
      return anthropic("claude-sonnet-4-20250514");
  }
}

function buildSystemPrompt(): string {
  const docs = listDocuments();
  const docList =
    docs.length > 0
      ? docs.map((d) => `- ${d.filename} (${d.pageCount} pages)`).join("\n")
      : "(no documents loaded yet)";

  return `You are a financial research analyst assistant. You have access to a set of parsed financial documents (SEC filings, reports, etc.).

Currently loaded documents:
${docList}

Your job is to help users analyze these financial documents by:
1. Searching for relevant information across filings
2. Reading specific pages for detailed context
3. Extracting and comparing financial metrics
4. Providing precise citations with page references

When answering questions:
- Always search the documents first — don't rely on your training data for specific numbers
- Cite your sources with the document filename and page number
- When comparing across periods, clearly label which filing each number comes from
- If you can't find information, say so rather than guessing
- Format financial data in markdown tables when comparing numbers

IMPORTANT — Inline citations:
When you reference a specific number, fact, or quote from a document, wrap the key phrase in a <cite> tag like this:
<cite file="example-10k-2024.pdf" page="42">394,328</cite>

Rules for cited text:
- The text inside <cite> tags MUST be copied exactly from the document — use the exact words, numbers, and formatting you see in the page text returned by the tools
- For numbers, use the exact format from the source (e.g. "416,161" not "$416 million", "6 %" not "6%")
- Keep citations short — a single number, a key phrase, or one sentence maximum
- Do NOT paraphrase, round, reformat, or add units that aren't in the source text
- If a table shows "416,161", cite "416,161" — not "$416,161 million"
- Use citations liberally for any concrete data point you reference

The UI uses these tags to highlight the exact source location in the PDF, so verbatim accuracy is critical.`;
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: getModel(),
    system: buildSystemPrompt(),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(30),
    experimental_transform: smoothStream({ chunking: "word" }),
  });

  return result.toUIMessageStreamResponse();
}
