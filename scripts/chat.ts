/**
 * Interactive financial research agent.
 * Uses Vercel AI SDK with tool calling to answer questions about parsed financial documents.
 *
 * Run with: npm run chat
 *
 * Set your API key via environment variable:
 *   ANTHROPIC_API_KEY=... npm run chat
 *   OPENAI_API_KEY=... npm run chat -- --provider openai
 */
import "dotenv/config";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createInterface } from "readline";
import { tools } from "../lib/tools";
import { listDocuments } from "../lib/store";

// Parse CLI args
const args = process.argv.slice(2);
const providerFlag = args.indexOf("--provider");
const provider =
  providerFlag !== -1 && args[providerFlag + 1]
    ? args[providerFlag + 1]
    : "anthropic";

function getModel() {
  switch (provider) {
    case "openai":
      return openai("gpt-4o");
    case "anthropic":
    default:
      return anthropic("claude-sonnet-4-20250514");
  }
}

const SYSTEM_PROMPT = `You are a financial research analyst assistant. You have access to a set of parsed SEC filings (10-K and 10-Q reports) for Apple Inc.

Your job is to help users analyze these financial documents by:
1. Searching for relevant information across filings
2. Reading specific pages for detailed context
3. Extracting and comparing financial metrics
4. Providing precise citations with page references

When answering questions:
- Always search the documents first — don't rely on your training data for specific numbers
- Cite your sources with the document filename and page number
- When comparing across periods, clearly label which filing each number comes from
- Use find_text_location to provide exact bounding box coordinates when users want to verify a specific claim
- If you can't find information, say so rather than guessing

Start by listing available documents so you know what you're working with.`;

async function chat() {
  const docs = listDocuments();
  console.log("\n📄 Financial Research Agent");
  console.log("━".repeat(50));
  console.log(`Loaded ${docs.length} documents:`);
  docs.forEach((d) => console.log(`  • ${d.filename} (${d.pageCount} pages)`));
  console.log("━".repeat(50));
  console.log(`Using provider: ${provider}`);
  console.log('Type your question, or "exit" to quit.\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on("close", () => {
    console.log("\nGoodbye!");
    process.exit(0);
  });

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  const askQuestion = () => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed.toLowerCase() === "exit") {
        console.log("\nGoodbye!");
        rl.close();
        return;
      }

      messages.push({ role: "user", content: trimmed });

      try {
        process.stdout.write("\nAgent: ");
        const result = await generateText({
          model: getModel(),
          system: SYSTEM_PROMPT,
          messages,
          tools,
          maxSteps: 10, // Allow multi-step tool use
          onStepFinish: ({ toolCalls }) => {
            if (toolCalls && toolCalls.length > 0) {
              for (const tc of toolCalls) {
                console.log(
                  `\n  [tool: ${tc.toolName}(${JSON.stringify(tc.args).slice(0, 80)}...)]`,
                );
              }
            }
          },
        });

        const response = result.text;
        console.log(response);
        messages.push({ role: "assistant", content: response });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\nError: ${message}`);
      }

      console.log();
      askQuestion();
    });
  };

  askQuestion();
}

chat().catch(console.error);
