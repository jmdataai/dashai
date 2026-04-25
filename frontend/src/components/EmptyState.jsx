import React from "react";
import { ArrowRight, Upload, BarChart3, Sparkles, Layers } from "lucide-react";

export default function EmptyState({ onSample }) {
  return (
    <div className="h-full w-full grid-bg overflow-y-auto dash-scroll" data-testid="empty-state">
      <div className="max-w-6xl mx-auto px-10 lg:px-14 pt-16 pb-24">
        {/* Eyebrow */}
        <div className="flex items-center gap-3 fade-up">
          <span className="dot-pulse" />
          <span className="tracking-eyebrow text-[11px] text-[var(--text-secondary)]">
            v1 · Plotly engine · Groq + Gemini fallback
          </span>
        </div>

        {/* Hero */}
        <h1
          className="font-display font-black mt-7 leading-[0.92] tracking-[-0.04em] heading-glow fade-up"
          style={{ animationDelay: "60ms", fontSize: "clamp(56px, 8vw, 124px)" }}
        >
          Upload anything.<br />
          <span className="text-[var(--accent-teal)]">Get a board-room dashboard.</span>
        </h1>

        <p
          className="text-[var(--text-secondary)] mt-7 max-w-2xl text-[17px] leading-relaxed fade-up"
          style={{ animationDelay: "120ms" }}
        >
          DashAI profiles your CSV/XLSX, asks Groq's <span className="text-[var(--neon-cyan)]">llama-3.3-70b</span> to
          architect a layout, and renders interactive Plotly charts on a hand-tuned obsidian canvas. Every dashboard is
          unique, exportable to HTML or PNG, and ready to demo.
        </p>

        {/* CTA cluster */}
        <div className="mt-10 flex flex-wrap items-center gap-3 fade-up" style={{ animationDelay: "200ms" }}>
          <button
            onClick={() => onSample("sales")}
            className="btn-primary flex items-center gap-2"
            data-testid="empty-try-sales-btn"
          >
            <Sparkles size={14} />
            Try sales sample
            <ArrowRight size={14} />
          </button>
          <button
            onClick={() => onSample("marketing")}
            className="btn-ghost flex items-center gap-2"
            data-testid="empty-try-marketing-btn"
          >
            <BarChart3 size={13} />
            Marketing dataset
          </button>
          <span className="text-xs text-[var(--text-muted)] tracking-eyebrow ml-2">
            or drop a file in the sidebar →
          </span>
        </div>

        {/* Feature pillars */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-4 fade-up" style={{ animationDelay: "260ms" }}>
          <Pillar
            color="var(--neon-cyan)"
            icon={<Upload size={18} strokeWidth={1.5} />}
            tag="01 · ingest"
            title="Smart profiling"
            body="Type-detection across numeric, categorical, datetime, boolean. Up to 50k rows, no setup."
          />
          <Pillar
            color="var(--neon-magenta)"
            icon={<Sparkles size={18} strokeWidth={1.5} />}
            tag="02 · plan"
            title="AI dashboard plan"
            body="Groq → Gemini fallback. The model chooses chart types, KPIs, hero, layout — never the same twice."
          />
          <Pillar
            color="var(--neon-yellow)"
            icon={<Layers size={18} strokeWidth={1.5} />}
            tag="03 · ship"
            title="HTML & PNG export"
            body="Self-contained HTML keeps interactivity. PNG snapshot for slack & slides. One click."
          />
        </div>

        {/* Chart catalogue */}
        <div className="mt-16 fade-up" style={{ animationDelay: "320ms" }}>
          <div className="tracking-eyebrow text-[11px] text-[var(--text-muted)] mb-4">
            Supported visualisations
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              "Bar", "Line", "Area", "Scatter", "Pie", "Donut",
              "Heatmap", "Histogram", "Box plot", "Treemap", "3D scatter",
            ].map((c) => (
              <span key={c} className="tag" style={{ background: "rgba(255,255,255,0.02)" }}>
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Pillar({ color, icon, tag, title, body }) {
  return (
    <div className="surface p-6 hover:-translate-y-0.5">
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
        style={{ background: `${color}1A`, color, border: `1px solid ${color}33` }}
      >
        {icon}
      </div>
      <div className="tracking-eyebrow text-[10px] text-[var(--text-muted)]">{tag}</div>
      <div className="font-display font-bold text-xl mt-1.5">{title}</div>
      <div className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">{body}</div>
    </div>
  );
}
