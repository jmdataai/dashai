import React, { useEffect, useState } from "react";

function formatValue(v, fmt) {
  if (v == null || isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (fmt === "currency") {
    if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  if (fmt === "percent") return `${Number(v).toFixed(1)}%`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (Number.isInteger(v)) return Number(v).toLocaleString();
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const COLORS = [
  "var(--neon-cyan)",
  "var(--neon-magenta)",
  "var(--neon-yellow)",
  "var(--neon-green)",
  "var(--neon-orange)",
  "var(--accent-teal)",
];

export default function KpiGrid({ kpis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4" data-testid="kpi-grid">
      {kpis.slice(0, 5).map((k, i) => (
        <KpiCard key={`${k.label}-${i}`} kpi={k} accent={COLORS[i % COLORS.length]} delay={i * 60} />
      ))}
    </div>
  );
}

function KpiCard({ kpi, accent, delay }) {
  const target = Number(kpi.value) || 0;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let raf;
    const start = performance.now();
    const dur = 700;
    const from = 0;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return (
    <div
      className="surface p-5 relative overflow-hidden fade-up"
      style={{ animationDelay: `${delay}ms` }}
      data-testid={`kpi-${kpi.label}`}
    >
      <div
        className="absolute top-0 left-0 w-full h-[2px]"
        style={{ background: accent, opacity: 0.7 }}
      />
      <div className="kpi-label">{kpi.label}</div>
      <div
        className="kpi-value mt-3"
        style={{ fontSize: "clamp(34px, 3.4vw, 52px)", color: "var(--text-primary)" }}
      >
        {formatValue(shown, kpi.format)}
      </div>
      {kpi.column && (
        <div className="text-[10px] mt-2 font-mono-tiny text-[var(--text-muted)] tracking-eyebrow">
          {kpi.metric} · {kpi.column}
        </div>
      )}
    </div>
  );
}
