import React, { useState, useRef, useEffect } from 'react';
import PlotlyChart from './PlotlyChart';
import useStore from '../store';
import { toast } from '../toast';
import { downloadChartCSV, suggestAltChartType } from '../utils';
import { apiImproveChart, apiChartUpdate } from '../api';

/* ── Aggregation label map ── */
const AGG_LABELS = { sum: 'SUM', mean: 'AVG', count: 'COUNT', max: 'MAX', min: 'MIN' };

/* ── Critic score colours ── */
const SCORE_COLOR = (s) => s >= 8 ? '#10b981' : s >= 5 ? '#f59e0b' : '#ef4444';

export default function ChartCard({ chart, idx, plotId, height = '360px' }) {
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [improving,   setImproving]   = useState(false);
  const [criticScores,setCriticScores]= useState(null);   // {bugs,transformation,compliance,type,encoding,aesthetics}
  const [showCritic,  setShowCritic]  = useState(false);
  const menuRef = useRef(null);

  const { openEdit, openFullscreen, deleteChart, duplicateChart, did, updateChart } = useStore();

  const is3D   = ['scatter3d','surface3d'].includes(chart.type);
  const isAnim = ['animated_bar','animated_scatter'].includes(chart.type);
  const domId  = plotId || `plt-${idx}`;
  const aggLabel = chart.spec?.agg ? AGG_LABELS[chart.spec.agg] : null;
  const aggCol   = chart.spec?.y   || chart.spec?.x || null;
  const altType  = suggestAltChartType(chart);

  useEffect(() => {
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  /* ── Download PNG ── */
  const downloadPNG = () => {
    setMenuOpen(false);
    const el = document.getElementById(domId);
    if (!el) return;
    try {
      window.Plotly.downloadImage(el, {
        format: 'png', scale: 2,
        filename: (chart.title || 'chart').replace(/\W+/g, '_'),
        width: 1200, height: 600,
      });
      toast.info('Downloading PNG…');
    } catch { toast.error('PNG download failed'); }
  };

  /* ── Download CSV ── */
  const downloadCSV = () => {
    setMenuOpen(false);
    const ok = downloadChartCSV(chart);
    ok ? toast.success('CSV downloaded!') : toast.error('No data to export');
  };

  /* ── Improve chart (LLM) ── */
  const improveChart = async () => {
    setMenuOpen(false);
    if (!did) return;
    setImproving(true);
    setShowCritic(false);
    setCriticScores(null);
    try {
      const result = await apiImproveChart(did, chart);
      updateChart(idx, {
        type:   result.type,
        figure: result.figure,
        spec:   result.spec,
        title:  result.title || chart.title,
      });
      if (result.critic) {
        setCriticScores(result.critic);
        setShowCritic(true);
      }
      toast.success('Chart improved!');
    } catch (e) {
      toast.error('Improve failed: ' + e.message);
    } finally {
      setImproving(false);
    }
  };

  /* ── Switch to alt chart type (zero LLM) ── */
  const switchToAlt = async () => {
    if (!altType || !did) return;
    try {
      const spec = { ...chart.spec, type: altType };
      const data = await apiChartUpdate(did, spec);
      updateChart(idx, { type: data.type, figure: data.figure, spec: data.spec });
      toast.success(`Switched to ${altType}`);
    } catch (e) {
      toast.error('Switch failed: ' + e.message);
    }
  };

  return (
    <div className={`chart-card${improving ? ' chart-card--improving' : ''}`}>

      {/* ── Header ── */}
      <div className="chart-hd">
        <div className="chart-hd-left">
          <span className="chart-title">{chart.title || ''}</span>
          <span className="chart-badge">{chart.type || 'chart'}</span>
          {is3D   && <span className="chart-badge b3d">3D</span>}
          {isAnim && <span className="chart-badge banim">▶ Anim</span>}
          {/* Aggregation badge — zero cost, from spec */}
          {aggLabel && (
            <span className="chart-badge bagg" title={`Aggregation: ${aggLabel} of ${aggCol}`}>
              {aggLabel}
            </span>
          )}
        </div>

        <div className="chart-hd-right">
          {/* ── Info tooltip (subtitle as insight) ── */}
          {chart.subtitle && (
            <div className="chart-info-wrap">
              <button className="chart-info-btn" aria-label="Chart insight">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M7 6v4M7 4.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
              <div className="chart-tooltip">
                <div className="chart-tooltip-arrow" />
                {chart.subtitle}
              </div>
            </div>
          )}

          {/* ── Critic scorecard toggle ── */}
          {criticScores && (
            <button
              className="chart-critic-btn"
              title="View AI quality scores"
              onClick={() => setShowCritic(v => !v)}
            >
              ✦ Scores
            </button>
          )}

          {/* ── Context menu ── */}
          <div className="menu-wrap" ref={menuRef}>
            <button className="menu-btn" onClick={() => setMenuOpen(o => !o)}>
              {improving ? <span className="spin" style={{width:12,height:12,display:'inline-block'}} /> : '⋮'}
            </button>
            {menuOpen && (
              <div className="ctx-menu">
                <button onClick={() => { setMenuOpen(false); openEdit(idx); }}>✎ Edit Chart</button>
                <button onClick={() => { setMenuOpen(false); openFullscreen(idx); }}>⛶ Fullscreen</button>
                <button onClick={downloadPNG}>↓ Download PNG</button>
                <button onClick={downloadCSV}>↓ Download CSV</button>
                <button onClick={improveChart} disabled={improving}>
                  {improving ? '⟳ Improving…' : '✦ Improve with AI'}
                </button>
                <button onClick={() => { setMenuOpen(false); duplicateChart(idx); toast.info('Chart duplicated'); }}>
                  ⧉ Duplicate
                </button>
                <button className="danger" onClick={() => { setMenuOpen(false); deleteChart(idx); toast.info('Chart removed'); }}>
                  ✕ Remove
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Alt chart type recommendation pill (zero LLM) ── */}
      {altType && !improving && (
        <div className="chart-alt-row">
          <button className="chart-alt-pill" onClick={switchToAlt} title={`Switch to ${altType}`}>
            Try as {altType} →
          </button>
        </div>
      )}

      {/* ── Critic scorecard ── */}
      {showCritic && criticScores && (
        <div className="critic-card">
          <div className="critic-card-hd">
            <span>✦ AI Quality Scores</span>
            <button className="critic-close" onClick={() => setShowCritic(false)}>✕</button>
          </div>
          <div className="critic-scores">
            {Object.entries(criticScores).map(([k, v]) => (
              <div key={k} className="critic-score-row">
                <span className="critic-score-label">{k}</span>
                <div className="critic-score-bar-wrap">
                  <div className="critic-score-bar" style={{ width: `${v * 10}%`, background: SCORE_COLOR(v) }} />
                </div>
                <span className="critic-score-val" style={{ color: SCORE_COLOR(v) }}>{v}/10</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Improving overlay ── */}
      {improving && (
        <div className="chart-improving-overlay">
          <div className="spin" style={{ width: 24, height: 24, borderWidth: 3 }} />
          <span>AI is improving this chart…</span>
        </div>
      )}

      {/* ── Chart ── */}
      <div id={domId} style={{ position: 'relative' }}>
        <PlotlyChart chart={chart} height={height} />
      </div>
    </div>
  );
}
