"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface DocInfo {
  filename: string;
  pageCount: number;
}

interface EdgarFiling {
  accessionNumber: string;
  filingDate: string;
  form: string;
  primaryDocument: string;
  primaryDocDescription: string;
}

export function DocumentManager() {
  const [documents, setDocuments] = useState<DocInfo[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<"docs" | "upload" | "edgar">("docs");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // EDGAR state
  const [ticker, setTicker] = useState("");
  const [formType, setFormType] = useState("10-K,10-Q");
  const [filings, setFilings] = useState<EdgarFiling[]>([]);
  const [edgarLoading, setEdgarLoading] = useState(false);
  const [selectedFilings, setSelectedFilings] = useState<Set<string>>(new Set());
  const [downloadingFilings, setDownloadingFilings] = useState<Set<string>>(new Set());
  const [downloadedFilings, setDownloadedFilings] = useState<Set<string>>(new Set());

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchDocuments();
  }, [isOpen, fetchDocuments]);

  const handleUpload = async (file: File) => {
    setLoading(true);
    setMessage(null);
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Added ${data.filename} (${data.pageCount} pages)`);
        fetchDocuments();
      } else {
        setMessage(data.error || "Upload failed");
      }
    } catch {
      setMessage("Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file?.name.endsWith(".pdf")) handleUpload(file);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const searchEdgar = async () => {
    if (!ticker.trim()) return;
    setEdgarLoading(true);
    setFilings([]);
    setSelectedFilings(new Set());
    setDownloadedFilings(new Set());
    setMessage(null);

    try {
      const res = await fetch(
        `/api/edgar?ticker=${encodeURIComponent(ticker)}&form=${encodeURIComponent(formType)}`,
      );
      const data = await res.json();
      if (res.ok) {
        setFilings(data.filings || []);
        if (data.filings?.length === 0) setMessage("No filings found");
      } else {
        setMessage(data.error || "Search failed");
      }
    } catch {
      setMessage("Search failed");
    } finally {
      setEdgarLoading(false);
    }
  };

  const downloadFiling = async (filing: EdgarFiling) => {
    setDownloadingFilings((prev) => new Set(prev).add(filing.accessionNumber));
    try {
      const res = await fetch("/api/edgar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          accessionNumber: filing.accessionNumber,
          primaryDocument: filing.primaryDocument,
          form: filing.form,
          filingDate: filing.filingDate,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDownloadedFilings((prev) => new Set(prev).add(filing.accessionNumber));
        fetchDocuments();
        return data;
      } else {
        setMessage(data.error || `Failed to download ${filing.form} — ${filing.filingDate}`);
      }
    } catch {
      setMessage(`Failed to download ${filing.form} — ${filing.filingDate}`);
    } finally {
      setDownloadingFilings((prev) => {
        const next = new Set(prev);
        next.delete(filing.accessionNumber);
        return next;
      });
    }
    return null;
  };

  const toggleSelection = (accessionNumber: string) => {
    setSelectedFilings((prev) => {
      const next = new Set(prev);
      if (next.has(accessionNumber)) next.delete(accessionNumber);
      else next.add(accessionNumber);
      return next;
    });
  };

  const downloadSelected = async () => {
    if (selectedFilings.size === 0) return;
    setMessage(null);
    const toDownload = filings.filter((f) => selectedFilings.has(f.accessionNumber));
    let added = 0;

    // Process sequentially to respect SEC rate limits
    for (const filing of toDownload) {
      const result = await downloadFiling(filing);
      if (result) added++;
    }

    setSelectedFilings(new Set());
    if (added > 0) {
      setMessage(`Added ${added} filing${added > 1 ? "s" : ""}`);
    }
  };

  const removeDoc = async (filename: string) => {
    await fetch("/api/documents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    fetchDocuments();
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-300"
      >
        <span>&#128196;</span>
        {documents.length > 0
          ? `${documents.length} docs`
          : "Manage Documents"}
      </button>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/60 pt-16">
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold">Document Manager</h2>
          <button
            onClick={() => setIsOpen(false)}
            className="text-zinc-500 hover:text-zinc-300"
          >
            &#x2715;
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800">
          {(
            [
              ["docs", "Documents"],
              ["upload", "Upload"],
              ["edgar", "SEC EDGAR"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setMessage(null);
              }}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                tab === key
                  ? "border-b-2 border-indigo-500 text-indigo-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="max-h-80 overflow-y-auto p-4">
          {/* Message banner */}
          {message && (
            <div className="mb-3 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300">
              {message}
            </div>
          )}

          {/* Documents tab */}
          {tab === "docs" && (
            <div className="space-y-1.5">
              {documents.length === 0 && (
                <div className="py-6 text-center text-xs text-zinc-500">
                  No documents loaded. Upload a PDF or search SEC EDGAR.
                </div>
              )}
              {documents.map((d) => (
                <div
                  key={d.filename}
                  className="flex items-center justify-between rounded-md border border-zinc-800 px-3 py-2"
                >
                  <div>
                    <div className="text-xs font-medium">{d.filename}</div>
                    <div className="text-[10px] text-zinc-500">
                      {d.pageCount} pages
                    </div>
                  </div>
                  <button
                    onClick={() => removeDoc(d.filename)}
                    className="text-[10px] text-zinc-600 hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Upload tab */}
          {tab === "upload" && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-700 py-10 text-center transition-colors hover:border-zinc-500"
            >
              {loading ? (
                <div className="text-xs text-zinc-400">
                  Parsing document...
                </div>
              ) : (
                <>
                  <div className="mb-2 text-3xl opacity-30">&#128228;</div>
                  <div className="text-xs text-zinc-400">
                    Drag &amp; drop a PDF here, or
                  </div>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="mt-2 rounded-md bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-400 transition-colors hover:bg-indigo-500/30"
                  >
                    Browse Files
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUpload(file);
                    }}
                  />
                </>
              )}
            </div>
          )}

          {/* EDGAR tab */}
          {tab === "edgar" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && searchEdgar()}
                  placeholder="Ticker (e.g. MSFT)"
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500"
                />
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none"
                >
                  <option value="10-K,10-Q">10-K &amp; 10-Q</option>
                  <option value="10-K">10-K only</option>
                  <option value="10-Q">10-Q only</option>
                </select>
                <button
                  onClick={searchEdgar}
                  disabled={edgarLoading || !ticker.trim()}
                  className="rounded-md bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-400 transition-colors hover:bg-indigo-500/30 disabled:opacity-50"
                >
                  {edgarLoading ? "..." : "Search"}
                </button>
              </div>

              {filings.length > 0 && (
                <div className="space-y-1.5">
                  {/* Bulk actions */}
                  <div className="flex items-center justify-between pb-1">
                    <label className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                      <input
                        type="checkbox"
                        checked={selectedFilings.size === filings.length && filings.length > 0}
                        onChange={() => {
                          if (selectedFilings.size === filings.length) {
                            setSelectedFilings(new Set());
                          } else {
                            setSelectedFilings(new Set(filings.map((f) => f.accessionNumber)));
                          }
                        }}
                        className="accent-indigo-500"
                      />
                      Select all
                    </label>
                    {selectedFilings.size > 0 && (
                      <button
                        onClick={downloadSelected}
                        disabled={downloadingFilings.size > 0}
                        className="rounded-md bg-indigo-500/20 px-2 py-1 text-[10px] font-medium text-indigo-400 transition-colors hover:bg-indigo-500/30 disabled:opacity-50"
                      >
                        {downloadingFilings.size > 0
                          ? `Downloading...`
                          : `Add ${selectedFilings.size} filing${selectedFilings.size > 1 ? "s" : ""}`}
                      </button>
                    )}
                  </div>

                  {filings.map((f) => {
                    const isDownloading = downloadingFilings.has(f.accessionNumber);
                    const isDownloaded = downloadedFilings.has(f.accessionNumber);
                    return (
                      <div
                        key={f.accessionNumber}
                        className="flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFilings.has(f.accessionNumber)}
                          onChange={() => toggleSelection(f.accessionNumber)}
                          disabled={isDownloading || isDownloaded}
                          className="accent-indigo-500"
                        />
                        <div className="flex-1">
                          <div className="text-xs font-medium">
                            {f.form}{" "}
                            <span className="font-normal text-zinc-400">
                              — {f.filingDate}
                            </span>
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            {f.primaryDocDescription || f.primaryDocument}
                          </div>
                        </div>
                        {isDownloaded ? (
                          <span className="text-[10px] text-green-400">Added</span>
                        ) : (
                          <button
                            onClick={() => downloadFiling(f)}
                            disabled={isDownloading || loading}
                            className="rounded-md bg-indigo-500/20 px-2 py-1 text-[10px] font-medium text-indigo-400 transition-colors hover:bg-indigo-500/30 disabled:opacity-50"
                          >
                            {isDownloading ? "..." : "Add"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
