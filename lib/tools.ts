/**
 * Agent tools for the financial research agent.
 * These are Vercel AI SDK tool definitions that the LLM can call.
 */
import { tool, zodSchema } from "ai";
import { z } from "zod";
import { searchDocuments, getPage, listDocuments } from "./store";

export const tools = {
  list_documents: tool({
    description:
      "List all ingested financial documents and their page counts. Call this first to understand what documents are available.",
    inputSchema: zodSchema(z.object({})),
    execute: async () => {
      const docs = listDocuments();
      return { documents: docs };
    },
  }),

  search_documents: tool({
    description:
      "Search across all financial documents for pages containing specific terms or patterns. Returns relevant page snippets with document and page references. Supports plain keyword search (default) or regex patterns when use_regex is true. Examples: 'revenue' (keyword), 'net income.*\\d+' (regex to find income followed by numbers), '\\$[\\d,]+\\s*million' (regex for dollar amounts).",
    inputSchema: zodSchema(
      z.object({
        query: z
          .string()
          .describe(
            "Search query — keywords (space-separated) or a regex pattern if use_regex is true",
          ),
        max_results: z
          .number()
          .optional()
          .default(5)
          .describe("Maximum number of results to return"),
        use_regex: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "If true, treat query as a regular expression (JavaScript regex syntax, case-insensitive)",
          ),
        file_glob: z
          .string()
          .optional()
          .describe(
            "Optional glob pattern to filter which documents are searched (e.g. 'apple-*', '*.pdf', '*2024*'). If omitted, all documents are searched.",
          ),
      }),
    ),
    execute: async ({ query, max_results, use_regex, file_glob }) => {
      const results = searchDocuments(query, max_results, use_regex, file_glob);
      if (results.length === 0) {
        return { message: "No results found for: " + query, results: [] };
      }
      return { results };
    },
  }),

  get_page: tool({
    description:
      "Get the full text content of a specific page in a document. Use this after searching to read the complete page context. Also returns textItems with bounding box coordinates for citations.",
    inputSchema: zodSchema(
      z.object({
        filename: z
          .string()
          .describe("Document filename (e.g. 'apple-10k-2024.pdf')"),
        page_number: z.number().describe("1-indexed page number"),
      }),
    ),
    execute: async ({ filename, page_number }) => {
      const page = getPage(filename, page_number);
      if (!page) {
        return { error: `Page ${page_number} not found in ${filename}` };
      }
      return {
        filename,
        page_number,
        text: page.text,
        text_item_count: page.textItems.length,
      };
    },
  }),

};
