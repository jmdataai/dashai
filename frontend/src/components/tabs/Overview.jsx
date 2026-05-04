import React from 'react';
import useStore from '../../store';
import ChartCard from '../ChartCard';
import { fmtKPI, KPI_COLORS, KPI_ICONS } from '../../utils';

export default function Overview() {
  const { dash } = useStore();
  if (!dash) return null;

  const charts = dash.charts || [];
  const hero   = charts.find(c => c.span >= 2) || charts[0];
  const subs   = charts.filter(c => c !== hero);

  return (
    <div className="canvas">
      {/* Header */}
      <div className="dash-hdr fade-up">
        <div className="dash-title">{dash.title || 'Dashboard'}</div>
        <div className="dash-sub">{dash.subtitle}</div>
      </div>

      {/* KPI grid */}
      {dash.kpis?.length > 0 && (
        <div className="kpi-grid">
          {dash.kpis.map((k, i) => {
            const val = k.formatted_value || fmtKPI(k.value, k.format);
            const tp  = k.trend_pct;
            const trendCls = tp == null ? '' : tp > 0 ? 'up' : tp < 0 ? 'down' : 'flat';
            const arrow = tp == null ? null : tp > 0 ? '↑' : tp < 0 ? '↓' : '→';
            return (
              <div key={i} className="kpi-card" style={{ '--kc': KPI_COLORS[i % KPI_COLORS.length] }}>
                <div className="kpi-hd">
                  <span className="kpi-lbl">{k.label}</span>
                  <span className="kpi-icon">{KPI_ICONS[i % KPI_ICONS.length]}</span>
                </div>
                <div className="kpi-val">{val}</div>
                <div className="kpi-sub">{k.column ? `${k.metric} of ${k.column}` : 'total records'}</div>
                {tp != null && (
                  <div className={`kpi-trend ${trendCls}`}>{arrow} {Math.abs(tp)}%</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* AI Insights box */}
      {dash.insights?.length > 0 && (
        <div className="insights-box fade-up d1">
          <div className="ib-header">
            <span style={{ fontSize: '14px' }}>✦</span>
            AI Insights
          </div>
          <ul className="ib-list">
            {dash.insights.map((ins, i) => (
              <li key={i} className="ib-item">{ins}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Hero chart */}
      {hero && (
        <div className="hero-row fade-up d2">
          <ChartCard chart={hero} idx={0} height="420px" />
        </div>
      )}

      {/* Sub charts grid */}
      {subs.length > 0 && (
        <div className="chart-grid fade-up d3">
          {subs.map((ch, i) => (
            <ChartCard key={ch.id} chart={ch} idx={i + 1} height="310px" />
          ))}
        </div>
      )}

      <div className="dash-footer">
        JMData Talent Dash · {new Date().toLocaleDateString()} · {charts.length} charts · AI
      </div>
    </div>
  );
}
