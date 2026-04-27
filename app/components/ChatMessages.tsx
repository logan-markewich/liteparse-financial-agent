"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CitedPage, Highlight } from "../page";

interface ParsedCite {
  file: string;
  page: number;
  phrase: string;
}

const CITE_REGEX =
  /<cite\s+file="([^"]+)"\s+page="(\d+)">([\s\S]*?)<\/cite>/g;

/** Extract all citations from text */
function extractCitations(text: string): ParsedCite[] {
  const cites: ParsedCite[] = [];
  let match;
  const re = new RegExp(CITE_REGEX.source, CITE_REGEX.flags);
  while ((match = re.exec(text)) !== null) {
    cites.push({
      file: match[1],
      page: parseInt(match[2], 10),
      phrase: match[3],
    });
  }
  return cites;
}

/**
 * Replace <cite> tags with markdown links and collect the cite data.
 * Uses hash-based hrefs (#cite-0, #cite-1) which survive react-markdown's
 * URL sanitization (unlike custom protocols like cite:).
 */
function replaceCitesWithLinks(text: string): {
  processed: string;
  cites: ParsedCite[];
} {
  const cites: ParsedCite[] = [];
  const processed = text.replace(CITE_REGEX, (_match, file, page, phrase) => {
    const idx = cites.length;
    cites.push({ file, page: parseInt(page, 10), phrase });
    return `[${phrase}](#cite-${idx})`;
  });
  return { processed, cites };
}

export function ChatMessages({
  messages,
  isLoading,
  onCitedPage,
  onCitationFocus,
}: {
  messages: UIMessage[];
  isLoading: boolean;
  onCitedPage: (page: CitedPage) => void;
  onCitationFocus: (highlight: Highlight) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Extract cited pages from <cite> tags in assistant text parts
  useEffect(() => {
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts) {
        if (part.type !== "text" || !("text" in part)) continue;
        for (const cite of extractCitations(part.text)) {
          onCitedPage({
            filename: cite.file,
            pageNumber: cite.page,
          });
        }
      }
    }
  }, [messages, onCitedPage]);

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
      {messages.length === 0 && (
        <div className="py-12 text-center text-sm text-zinc-500">
          Upload documents or search SEC EDGAR, then ask questions about them.
        </div>
      )}

      {messages.map((message, mi) => (
        <MessageBubble
          key={message.id}
          message={message}
          onCitationFocus={onCitationFocus}
          isStreaming={isLoading && mi === messages.length - 1}
        />
      ))}

      {isLoading &&
        messages.length > 0 &&
        messages[messages.length - 1].role === "user" && (
          <div className="flex gap-1.5 py-2">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:100ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:200ms]" />
          </div>
        )}

      <div ref={bottomRef} />
    </div>
  );
}

function MessageBubble({
  message,
  onCitationFocus,
  isStreaming,
}: {
  message: UIMessage;
  onCitationFocus: (highlight: Highlight) => void;
  isStreaming: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl rounded-br-sm border border-brand-purple/30 bg-brand-purple/15 px-3.5 py-2.5 text-sm">
          {message.parts
            .filter((p) => p.type === "text")
            .map((p, i) => (
              <span key={i}>{"text" in p ? p.text : ""}</span>
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          if (!part.text.trim()) return null;
          return (
            <TextPartWithCites
              key={i}
              text={part.text}
              onCitationFocus={onCitationFocus}
              isStreaming={isStreaming}
            />
          );
        }

        if (part.type === "step-start") {
          return null;
        }

        if (part.type.startsWith("tool-")) {
          const toolPart = part as {
            type: string;
            toolName?: string;
            state: string;
            input?: Record<string, unknown>;
          };
          // Tool name is either in toolName (dynamic tools) or encoded in the type as "tool-<name>"
          const toolName = toolPart.toolName || part.type.replace(/^tool-/, "");
          return (
            <ToolCallPart
              key={i}
              toolName={toolName}
              state={toolPart.state}
              input={toolPart.input}
            />
          );
        }

        return null;
      })}
    </div>
  );
}

/**
 * Renders a text part, replacing <cite> tags with interactive badges.
 * Each text part gets its own cite array so indices are self-contained.
 */
function TextPartWithCites({
  text,
  onCitationFocus,
  isStreaming,
}: {
  text: string;
  onCitationFocus: (highlight: Highlight) => void;
  isStreaming: boolean;
}) {
  const { processed, cites } = useMemo(
    () => replaceCitesWithLinks(text),
    [text],
  );

  const components = useMemo(
    () => ({
      ...markdownComponents,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      a: (props: any) => {
        const href: string | undefined = props.href;
        const children: React.ReactNode = props.children;

        if (href?.startsWith("#cite-")) {
          const idx = parseInt(href.slice(6), 10);
          const cite = cites[idx];
          if (!cite) return <>{children}</>;

          return (
            <CiteBadge cite={cite} onFocus={onCitationFocus} isStreaming={isStreaming}>
              {children}
            </CiteBadge>
          );
        }

        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-purple underline"
          >
            {children}
          </a>
        );
      },
    }),
    [cites, onCitationFocus],
  );

  return (
    <div className="prose-invert text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}

/**
 * A citation badge that verifies itself against the cite API.
 * Shows a verified (brand-colored) or unverified (yellow warning) style.
 */
function CiteBadge({
  cite,
  onFocus,
  children,
  isStreaming,
}: {
  cite: ParsedCite;
  onFocus: (highlight: Highlight) => void;
  children: React.ReactNode;
  isStreaming: boolean;
}) {
  const [verified, setVerified] = useState<boolean | null>(null);

  // Only verify once streaming is complete so we don't fire on partial text
  useEffect(() => {
    if (isStreaming) return;
    let cancelled = false;
    fetch("/api/cite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: cite.file,
        pageNumber: cite.page,
        phrase: cite.phrase,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setVerified(data.locations?.length > 0);
      })
      .catch(() => {
        if (!cancelled) setVerified(false);
      });
    return () => { cancelled = true; };
  }, [isStreaming, cite.file, cite.page, cite.phrase]);

  const handleFocus = useCallback(() => {
    onFocus({
      filename: cite.file,
      pageNumber: cite.page,
      phrase: cite.phrase,
    });
  }, [cite, onFocus]);

  // During streaming or before verification completes, show default style
  const isUnverified = !isStreaming && verified === false;

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleFocus();
      }}
      onMouseEnter={handleFocus}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleFocus();
      }}
      className={`mx-0.5 inline-flex cursor-pointer items-baseline gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold transition-colors ${
        isUnverified
          ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20"
          : "border-brand-purple/30 bg-brand-purple/10 text-brand-purple hover:bg-brand-purple/20"
      }`}
      title={
        isUnverified
          ? `Could not verify in ${cite.file} p.${cite.page}`
          : `${cite.file} p.${cite.page}`
      }
    >
      <span className={isUnverified ? "text-yellow-300" : "text-brand-blue"}>
        {children}
      </span>
      <span className="text-[9px] text-zinc-500">
        p.{cite.page}{isUnverified && " ?"}
      </span>
    </span>
  );
}

function ToolCallPart({
  toolName,
  state,
  input,
}: {
  toolName: string;
  state: string;
  input?: Record<string, unknown>;
}) {
  const argsStr = input
    ? Object.entries(input)
        .map(([k, v]) => {
          const val =
            typeof v === "string" && v.length > 25
              ? v.slice(0, 25) + "..."
              : v;
          return `${k}: ${JSON.stringify(val)}`;
        })
        .join(", ")
    : "";

  const isRunning =
    state === "input-available" || state === "input-streaming";

  return (
    <div className="my-1 flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-[11px] text-zinc-500">
      <span className={isRunning ? "animate-spin" : ""}>
        {isRunning ? "\u2699" : "\u2713"}
      </span>
      <span className="text-brand-purple">{toolName}</span>
      {argsStr && <span className="truncate">({argsStr})</span>}
    </div>
  );
}

const markdownComponents = {
  table: ({ children }: { children?: React.ReactNode }) => (
    <table className="my-2 w-full border-collapse text-xs">{children}</table>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-zinc-700 px-2.5 py-1.5">{children}</td>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="text-white">{children}</strong>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-xs">
      {children}
    </code>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 list-disc pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 list-decimal pl-5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="mb-1">{children}</li>
  ),
};
