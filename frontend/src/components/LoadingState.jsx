import React from "react";

const STEPS = [
  "Reading file",
  "Profiling columns",
  "Asking the AI planner",
  "Building Plotly figures",
  "Composing layout",
];

export default function LoadingState({ stage = "Working…" }) {
  return (
    <div className="h-full w-full grid-bg flex flex-col items-center justify-center" data-testid="loading-state">
      <div className="flex items-center gap-3">
        <span className="dot-pulse" />
        <span className="tracking-eyebrow text-[11px] text-[var(--text-secondary)]">
          {stage}
        </span>
      </div>
      <div className="font-display font-black tracking-[-0.04em] mt-6 text-center"
        style={{ fontSize: "clamp(40px, 6vw, 72px)" }}>
        Composing your<br />
        <span className="text-[var(--accent-teal)]">dashboard…</span>
      </div>
      <ul className="mt-10 space-y-2 font-mono-tiny text-xs text-[var(--text-secondary)]">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-3">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: "var(--accent-teal)",
                opacity: 1 - i * 0.15,
                animation: `pulse 1.4s ${i * 0.18}s ease-in-out infinite`,
              }}
            />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
