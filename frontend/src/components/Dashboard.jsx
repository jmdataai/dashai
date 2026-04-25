import React, { forwardRef } from "react";
import KpiGrid from "@/components/KpiGrid";
import PlotChart from "@/components/PlotChart";
import { Cpu, Hash } from "lucide-react";

const Dashboard = forwardRef(function Dashboard({ dashboard, generating, dataset }, ref) {
  return (
    <div className="px-8 lg:px-12 py-10 max-w-[1600px] mx-auto" data-testid="dashboard">
      {/* Header */}
      <div ref={ref} data-testid="dashboard-canvas">
        <header className="flex flex-col gap-3 mb-10 fade-up">
          <div className="flex items-center gap-3 text-[11px] tracking-eyebrow text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <Cpu size={12} strokeWidth={1.5} />
              <span>provider · {dashboard.provider}</span>
            </span>
            <span className="opacity-40">•</span>
            <span className="flex items-center gap-1.5">
              <Hash size={12} strokeWidth={1.5} />
              <span className="font-mono-tiny">seed {dashboard.seed}</span>
            </span>
            <span className="opacity-40">•</span>
            <span>{dataset?.rows.toLocaleString()} rows · {dataset?.cols} dims</span>
            {generating && (
              <>
                <span className="opacity-40">•</span>
                <span className="text-[var(--accent-teal)]">refreshing…</span>
              </>
            )}
          </div>
          <h1
            className="font-display font-black tracking-[-0.04em] heading-glow"
            style={{ fontSize: "clamp(38px, 5vw, 64px)", lineHeight: 1 }}
            data-testid="dashboard-title"
          >
            {dashboard.title}
          </h1>
          {dashboard.subtitle && (
            <p className="text-[var(--text-secondary)] max-w-3xl text-[15px] leading-relaxed">
              {dashboard.subtitle}
            </p>
          )}
        </header>

        {/* KPIs */}
        {dashboard.kpis?.length > 0 && (
          <KpiGrid kpis={dashboard.kpis} />
        )}

        {/* Charts */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-5 mt-8"
          data-testid="charts-grid"
        >
          {dashboard.charts.map((c, idx) => (
            <ChartCard key={c.id || idx} chart={c} delay={idx * 60} />
          ))}
        </div>

        {/* Footer */}
        <div className="mt-10 pt-5 border-t border-[var(--border-structural)] flex items-center justify-between text-[10px] tracking-eyebrow text-[var(--text-muted)]">
          <span>generated · {new Date(dashboard.generated_at).toLocaleString()}</span>
          <span>DashAI · Plotly · Groq + Gemini</span>
        </div>
      </div>
    </div>
  );
});

function ChartCard({ chart, delay }) {
  const span = chart.span >= 2 ? "md:col-span-2 xl:col-span-2" : "";
  const minH = chart.span >= 2 ? 460 : 360;
  return (
    <div
      className={`surface p-6 fade-up ${span}`}
      style={{ animationDelay: `${delay}ms` }}
      data-testid={`chart-card-${chart.id}`}
    >
      <header className="mb-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-lg leading-tight">{chart.title}</h3>
          <span className="font-mono-tiny text-[10px] text-[var(--text-muted)] tracking-eyebrow">
            {chart.type}
          </span>
        </div>
        {chart.subtitle && (
          <p className="text-xs text-[var(--text-secondary)] mt-1">{chart.subtitle}</p>
        )}
      </header>
      <PlotChart figure={chart.figure} minHeight={minH} />
    </div>
  );
}

export default Dashboard;
