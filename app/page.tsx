"use client";

import { useChat } from "@ai-sdk/react";
import { ChatMessages } from "./components/ChatMessages";
import { ChatInput } from "./components/ChatInput";
import { CitationViewer } from "./components/CitationViewer";
import { DocumentManager } from "./components/DocumentManager";
import { SlidePanel } from "./components/SlidePanel";
import { useCallback, useState } from "react";

/** A unique page referenced by at least one citation */
export interface CitedPage {
  filename: string;
  pageNumber: number;
}

/** A specific phrase highlight on a page */
export interface Highlight {
  filename: string;
  pageNumber: number;
  phrase: string;
}

export default function Home() {
  const { messages, sendMessage, status } = useChat();
  const [pages, setPages] = useState<CitedPage[]>([]);
  const [activePageIdx, setActivePageIdx] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [slidesOpen, setSlidesOpen] = useState(false);

  /** Called by ChatMessages when <cite> tags are parsed — registers unique pages */
  const addCitedPage = useCallback((page: CitedPage) => {
    setPages((prev) => {
      const exists = prev.some(
        (p) => p.filename === page.filename && p.pageNumber === page.pageNumber,
      );
      if (exists) return prev;
      const next = [...prev, page];
      setActivePageIdx(next.length - 1);
      return next;
    });
  }, []);

  /** Called when user clicks/hovers a citation badge — show that page + highlight */
  const focusCitation = useCallback(
    (h: Highlight) => {
      // Ensure page is registered
      addCitedPage({ filename: h.filename, pageNumber: h.pageNumber });
      // Switch to that page
      setPages((prev) => {
        const idx = prev.findIndex(
          (p) => p.filename === h.filename && p.pageNumber === h.pageNumber,
        );
        if (idx >= 0) setActivePageIdx(idx);
        return prev;
      });
      setHighlight(h);
    },
    [addCitedPage],
  );

  /** Called when user clicks a page tab — show page, clear highlight */
  const selectPage = useCallback((idx: number) => {
    setActivePageIdx(idx);
    setHighlight(null);
  }, []);

  const isLoading = status === "streaming" || status === "submitted";

  return (
    <div className="flex h-screen">
      {/* Chat Panel */}
      <div className="flex w-1/2 min-w-[420px] flex-col border-r border-zinc-800">
        <div className="border-b border-zinc-800 bg-zinc-950 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-base font-semibold">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/llamaindex-icon.svg"
                  alt="LlamaIndex"
                  className="h-6"
                />
                Financial Research Agent
              </h1>
              <p className="mt-0.5 text-xs text-zinc-500">
                Powered by LiteParse &middot; SEC Filings
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSlidesOpen((v) => !v)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  slidesOpen
                    ? "border-zinc-500 bg-zinc-800 text-zinc-100"
                    : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
                }`}
              >
                Slides
              </button>
              <DocumentManager />
            </div>
          </div>
        </div>

        <ChatMessages
          messages={messages}
          isLoading={isLoading}
          onCitedPage={addCitedPage}
          onCitationFocus={focusCitation}
        />

        <ChatInput
          onSend={(text) => sendMessage({ text })}
          disabled={isLoading}
        />
      </div>

      {/* Citation Viewer Panel */}
      <div className="flex flex-1 flex-col bg-zinc-900">
        <CitationViewer
          pages={pages}
          activePageIdx={activePageIdx}
          highlight={highlight}
          onSelectPage={selectPage}
        />
      </div>

      {/* Presenter Slides Panel */}
      {slidesOpen && (
        <SlidePanel
          onClose={() => setSlidesOpen(false)}
          onSendPrompt={(text) => sendMessage({ text })}
        />
      )}
    </div>
  );
}
