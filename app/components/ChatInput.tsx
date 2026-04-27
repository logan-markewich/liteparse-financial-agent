"use client";

import { useState } from "react";

const SUGGESTIONS = [
  "What documents are available?",
  "Compare revenue across filings",
  "What are the key risk factors?",
  "Summarize the balance sheet",
];

export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);

  const handleSend = () => {
    const text = input.trim();
    if (!text || disabled) return;
    setInput("");
    setShowSuggestions(false);
    onSend(text);
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-900 px-5 py-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) handleSend();
          }}
          placeholder="Ask about your financial documents..."
          disabled={disabled}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-indigo-500 disabled:opacity-50"
          autoFocus
        />
        <button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </div>

      {showSuggestions && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setInput(s);
                setShowSuggestions(false);
                onSend(s);
              }}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-indigo-500 hover:text-zinc-200"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
