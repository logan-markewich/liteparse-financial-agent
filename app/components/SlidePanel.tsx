"use client";

import { useCallback, useEffect, useState } from "react";
import { SLIDES } from "./slides";

// Survives panel close/reopen so the presenter resumes where they left off.
let savedIndex = 0;

export function SlidePanel({
  onClose,
  onSendPrompt,
}: {
  onClose: () => void;
  onSendPrompt: (text: string) => void;
}) {
  const [index, setIndex] = useState(savedIndex);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    savedIndex = index;
  }, [index]);

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const next = useCallback(
    () => setIndex((i) => Math.min(SLIDES.length - 1, i + 1)),
    [],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next, onClose]);

  useEffect(() => {
    setCopied(false);
  }, [index]);

  const slide = SLIDES[index];

  return (
    <div className="flex w-[840px] shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Presenter &middot; {index + 1} / {SLIDES.length}
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300"
          title="Close (Esc)"
        >
          &#x2715;
        </button>
      </div>

      {/* Slide body */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {slide.kicker && (
          <div className="mb-1.5 text-sm font-medium uppercase tracking-wider text-zinc-500">
            {slide.kicker}
          </div>
        )}
        <h2 className="mb-5 text-3xl font-semibold text-zinc-100">
          {slide.title}
        </h2>
        {slide.content}

        {slide.prompt && (
          <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              Demo prompt
            </div>
            <p className="mb-3 text-sm leading-relaxed text-zinc-300">
              {slide.prompt}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(slide.prompt!);
                  setCopied(true);
                }}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={() => onSendPrompt(slide.prompt!)}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/85"
              >
                Send to chat
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
        <button
          onClick={prev}
          disabled={index === 0}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 disabled:opacity-30"
        >
          &larr; Prev
        </button>
        <div className="flex gap-1">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                i === index ? "bg-zinc-200" : "bg-zinc-700 hover:bg-zinc-500"
              }`}
            />
          ))}
        </div>
        <button
          onClick={next}
          disabled={index === SLIDES.length - 1}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 disabled:opacity-30"
        >
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
