"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { CitedPage, Highlight } from "../page";

interface Location {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function CitationViewer({
  pages,
  activePageIdx,
  highlight,
  onSelectPage,
}: {
  pages: CitedPage[];
  activePageIdx: number | null;
  highlight: Highlight | null;
  onSelectPage: (index: number) => void;
}) {
  const activePage =
    activePageIdx !== null && activePageIdx < pages.length
      ? pages[activePageIdx]
      : null;

  return (
    <>
      {/* Header with page tabs */}
      <div className="border-b border-zinc-800 bg-zinc-900 px-5 py-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">
            {activePage
              ? `${activePage.filename} — Page ${activePage.pageNumber}`
              : "Citation Viewer"}
          </span>
          {pages.length > 0 && (
            <span className="text-[10px] text-zinc-600">
              {pages.length} page{pages.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Page tabs */}
        {pages.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {pages.map((p, i) => (
              <button
                key={`${p.filename}-${p.pageNumber}`}
                onClick={() => onSelectPage(i)}
                className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                  i === activePageIdx
                    ? "border-zinc-500 bg-zinc-800 text-zinc-100"
                    : "border-transparent bg-zinc-800/50 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p.filename.replace(/\.pdf$/, "")} p.{p.pageNumber}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Page viewer */}
      <div className="flex-1 overflow-auto">
        {!activePage ? (
          <div className="flex h-full flex-col items-center justify-center text-zinc-600">
            <div className="text-sm">Citations will appear here</div>
            <div className="mt-1 text-xs">
              Ask a question and the agent will reference specific pages
            </div>
          </div>
        ) : (
          <PageRenderer
            key={`${activePage.filename}-${activePage.pageNumber}`}
            page={activePage}
            highlight={highlight}
          />
        )}
      </div>
    </>
  );
}

const SCALE_FACTOR = 150 / 72; // DPI / PDF points per inch

function PageRenderer({
  page,
  highlight,
}: {
  page: CitedPage;
  highlight: Highlight | null;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch the page screenshot
  useEffect(() => {
    let cancelled = false;
    setImageUrl(null);
    setNaturalSize(null);
    setError(null);

    async function loadPage() {
      try {
        const url = `/api/screenshot/${encodeURIComponent(page.filename)}/${page.pageNumber}`;
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Failed to load page: ${res.status} ${body}`);
        }

        const blob = await res.blob();
        if (blob.size === 0) {
          throw new Error("Empty response from screenshot API");
        }

        if (!cancelled) {
          setImageUrl(URL.createObjectURL(blob));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    loadPage();
    return () => {
      cancelled = true;
    };
  }, [page.filename, page.pageNumber]);

  // Resolve bounding boxes when a highlight is active for this page
  useEffect(() => {
    if (
      !highlight ||
      highlight.filename !== page.filename ||
      highlight.pageNumber !== page.pageNumber
    ) {
      setLocations([]);
      return;
    }

    let cancelled = false;

    async function resolveCite() {
      try {
        const res = await fetch("/api/cite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: highlight!.filename,
            pageNumber: highlight!.pageNumber,
            phrase: highlight!.phrase,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setLocations(data.locations?.length > 0 ? data.locations : []);
        }
      } catch {
        // Silently fail
      }
    }

    resolveCite();
    return () => {
      cancelled = true;
    };
  }, [highlight, page.filename, page.pageNumber]);

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    },
    [],
  );

  // Scroll to first highlight when it appears
  useEffect(() => {
    if (naturalSize && locations.length > 0 && highlightRef.current) {
      const timer = setTimeout(() => {
        highlightRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [naturalSize, locations]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (!imageUrl) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse text-xs text-zinc-500">
          Loading page&hellip;
        </div>
      </div>
    );
  }

  return (
    <div className="p-4" ref={containerRef}>
      <div className="relative inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={`Page ${page.pageNumber}`}
          className="block max-w-full"
          onLoad={handleImageLoad}
        />

        {/* Highlight overlays — only shown when a specific citation is focused */}
        {naturalSize &&
          locations.map((loc, i) => {
            const pxX = loc.x * SCALE_FACTOR;
            const pxY = loc.y * SCALE_FACTOR;
            const pxW = loc.width * SCALE_FACTOR;
            const pxH = Math.max(loc.height * SCALE_FACTOR, 14);

            return (
              <div
                key={i}
                ref={i === 0 ? highlightRef : undefined}
                className="pointer-events-none absolute rounded-sm border-2 border-yellow-400/80 bg-yellow-400/25"
                style={{
                  left: `${(pxX / naturalSize.w) * 100}%`,
                  top: `${(pxY / naturalSize.h) * 100}%`,
                  width: `${(pxW / naturalSize.w) * 100}%`,
                  height: `${(pxH / naturalSize.h) * 100}%`,
                }}
              />
            );
          })}
      </div>
    </div>
  );
}
