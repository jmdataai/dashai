import React, { useRef, useState } from "react";
import { Upload, FileSpreadsheet, Sparkles, RotateCcw, Download, Code2, X, Database } from "lucide-react";

const SAMPLES = [
  { id: "sales", label: "Sales · 24 months", icon: "$" },
  { id: "marketing", label: "Marketing · 600 campaigns", icon: "%" },
];

export default function Sidebar({
  dataset,
  dashboard,
  uploading,
  generating,
  exporting,
  onUpload,
  onSample,
  onGenerate,
  onRegenerate,
  onExportHtml,
  onExportPng,
  onReset,
}) {
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onUpload(file);
  };

  return (
    <aside
      className="w-80 2xl:w-96 shrink-0 h-full flex flex-col border-r border-[var(--border-structural)] bg-[var(--bg-sidebar)]"
      data-testid="sidebar"
    >
      {/* Brand */}
      <div className="px-6 pt-7 pb-5 flex items-center gap-3 border-b border-[var(--border-structural)]">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center font-display font-black text-[var(--bg-void)] text-lg"
          style={{ background: "linear-gradient(135deg, var(--accent-teal), var(--neon-cyan))" }}>
          ⌬
        </div>
        <div>
          <div className="font-display font-black text-[18px] leading-none tracking-tight">DashAI</div>
          <div className="text-[10px] tracking-eyebrow text-[var(--text-muted)] mt-1">v1 · Plotly engine</div>
        </div>
      </div>

      {/* Upload zone */}
      <div className="px-6 pt-6 pb-4 space-y-4">
        <div className="text-[11px] tracking-eyebrow text-[var(--text-muted)]">Dataset</div>

        {!dataset ? (
          <>
            <div
              className={`dropzone ${dragging ? "dragging" : ""}`}
              data-testid="upload-zone"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,.tsv,.txt"
                hidden
                data-testid="file-input"
                onChange={(e) => onUpload(e.target.files?.[0])}
              />
              <div className="flex flex-col items-center text-center gap-2">
                <Upload size={22} className="text-[var(--accent-teal)]" strokeWidth={1.5} />
                <div className="text-sm text-[var(--text-primary)] font-medium">Drop CSV / XLSX</div>
                <div className="text-[11px] text-[var(--text-secondary)]">or click to browse · max 25MB</div>
              </div>
            </div>

            <div className="space-y-1.5 pt-2">
              <div className="text-[11px] tracking-eyebrow text-[var(--text-muted)] mb-2">Try a sample</div>
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSample(s.id)}
                  disabled={uploading}
                  className="btn-ghost w-full flex items-center justify-between"
                  data-testid={`sample-${s.id}-btn`}
                >
                  <span className="flex items-center gap-2">
                    <Database size={14} className="text-[var(--neon-cyan)]" strokeWidth={1.5} />
                    <span>{s.label}</span>
                  </span>
                  <span className="font-mono-tiny text-[10px] text-[var(--text-muted)]">→</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <DatasetCard dataset={dataset} onReset={onReset} />
        )}
      </div>

      {/* Actions */}
      {dataset && (
        <div className="px-6 pt-2 pb-4 space-y-3 border-t border-[var(--border-structural)]">
          <div className="text-[11px] tracking-eyebrow text-[var(--text-muted)] pt-3">Engine</div>
          <button
            onClick={onGenerate}
            disabled={generating}
            className="btn-primary w-full flex items-center justify-center gap-2"
            data-testid="generate-btn"
          >
            <Sparkles size={14} strokeWidth={2} />
            {generating ? "Generating…" : dashboard ? "Regenerate Dashboard" : "Generate Dashboard"}
          </button>
          {dashboard && (
            <button
              onClick={onRegenerate}
              disabled={generating}
              className="btn-ghost w-full flex items-center justify-center gap-2"
              data-testid="shuffle-btn"
            >
              <RotateCcw size={13} strokeWidth={1.5} />
              Shuffle layout
            </button>
          )}
        </div>
      )}

      {/* Export */}
      {dashboard && (
        <div className="px-6 pt-2 pb-4 space-y-2 border-t border-[var(--border-structural)]">
          <div className="text-[11px] tracking-eyebrow text-[var(--text-muted)] pt-3">Export</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onExportHtml}
              disabled={exporting}
              className="btn-ghost flex items-center justify-center gap-1.5"
              data-testid="export-html-btn"
            >
              <Code2 size={13} strokeWidth={1.5} />
              <span>HTML</span>
            </button>
            <button
              onClick={onExportPng}
              disabled={exporting}
              className="btn-ghost flex items-center justify-center gap-1.5"
              data-testid="export-png-btn"
            >
              <Download size={13} strokeWidth={1.5} />
              <span>PNG</span>
            </button>
          </div>
        </div>
      )}

      {/* Schema */}
      {dataset && (
        <div className="flex-1 overflow-y-auto dash-scroll px-6 pb-6 border-t border-[var(--border-structural)] pt-3">
          <div className="text-[11px] tracking-eyebrow text-[var(--text-muted)] mb-3">Schema · {dataset.cols} cols</div>
          <ul className="space-y-2" data-testid="schema-list">
            {dataset.columns.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-[var(--text-primary)]" title={c.name}>{c.name}</span>
                <span className={`tag tag-${c.semantic}`}>{c.semantic.slice(0, 4)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer */}
      <div className="px-6 py-3 border-t border-[var(--border-structural)] text-[10px] tracking-eyebrow text-[var(--text-muted)] flex items-center justify-between">
        <span>powered by Plotly</span>
        <span className="font-mono-tiny">★ premium</span>
      </div>
    </aside>
  );
}

function DatasetCard({ dataset, onReset }) {
  return (
    <div className="surface p-4" data-testid="dataset-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileSpreadsheet size={16} className="text-[var(--accent-teal)]" strokeWidth={1.5} />
          <span className="text-sm font-semibold truncate" title={dataset.filename}>
            {dataset.filename}
          </span>
        </div>
        <button
          onClick={onReset}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          data-testid="reset-btn"
        >
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <Stat label="Rows" value={dataset.rows.toLocaleString()} />
        <Stat label="Cols" value={dataset.cols} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-[var(--bg-void)] border border-[var(--border-structural)] rounded-lg px-3 py-2">
      <div className="kpi-label text-[9px]">{label}</div>
      <div className="font-display font-bold text-lg mt-0.5">{value}</div>
    </div>
  );
}
