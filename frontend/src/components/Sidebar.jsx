import React from 'react';
import useStore from '../store';
import { toast } from '../toast';
import { apiExportHtml } from '../api';
import { downloadBlob } from '../utils';

const TABS = [
  { id: 'overview', label: 'Overview', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>
  )},
  { id: 'charts', label: 'Charts', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="8" width="3" height="7" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="6.5" y="4" width="3" height="11" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="11" y="1" width="3" height="14" rx="1" stroke="currentColor" strokeWidth="1.3"/></svg>
  )},
  { id: 'insights', label: 'Insights', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1l1.8 3.6L14 5.3l-3 2.9.7 4.1L8 10.5 4.3 12.3l.7-4.1-3-2.9 4.2-.7L8 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
  )},
  { id: 'stats', label: 'Column Stats', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
  )},
  { id: 'data', label: 'Data', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><ellipse cx="8" cy="4" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.3"/><path d="M2 4v8c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V4" stroke="currentColor" strokeWidth="1.3"/><path d="M2 8c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" stroke="currentColor" strokeWidth="1.3"/></svg>
  )},
];

/* Inline JM mark for collapsed sidebar state */
function JMBlueMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="7" fill="#4468B0"/>
      <path d="M5 5 L5 22 Q5 28 0 28" stroke="#0C162A" strokeWidth="0" fill="none"/>
      <path d="M4 5 L10 5 L10 21 Q10 27 3 27 L1 27 Q-0.5 27 -0.5 25.5 L-0.5 24 Q4 24 4 20 Z" fill="#0C162A" transform="translate(3,1.5) scale(0.82)"/>
      <path d="M13 5 L17 5 L20 16 L23 5 L27 5 L27 27 L22 27 L22 17 L20 27 L16 27 L14 17 L14 27 L9 27 L9 5 Z" fill="#0C162A" transform="translate(4,1.5) scale(0.72)"/>
    </svg>
  );
}

export default function Sidebar({ onRegenerate }) {
  const { activeTab, setActiveTab, sidebarCollapsed, toggleSidebar, file, dash, goToLanding } = useStore();

  const exportHTML = async () => {
    if (!dash) return;
    try {
      const blob = await apiExportHtml(dash);
      downloadBlob(blob, (dash.title || 'dashboard').replace(/\W+/g, '_') + '.html');
      toast.success('HTML exported!');
    } catch (e) { toast.error('Export failed: ' + e.message); }
  };

  const exportPNG = () => {
    const charts = dash?.charts || [];
    if (!charts.length) { toast.warn('Generate a dashboard first'); return; }
    const base = (dash?.title || 'chart').replace(/\W+/g, '_');
    let found = 0;
    charts.forEach((c, i) => {
      const candidates = [`plt-${i}`, `charts-plt-${i}`];
      candidates.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        setTimeout(() => {
          try {
            window.Plotly.downloadImage(el, {
              format: 'png', scale: 2,
              filename: `${base}_${i + 1}`,
              width: i === 0 ? 1400 : 900,
              height: i === 0 ? 660 : 480,
            });
            found++;
          } catch {}
        }, found * 800);
        found++;
      });
    });
    if (found === 0) { toast.warn('Open Overview or Charts tab first, then export PNG'); return; }
    toast.info('Downloading PNGs…');
  };

  return (
    <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
      <div className="sb-brand">
        {/* Logo mark — shows image if available, falls back to inline SVG */}
        <div className="brand-mark sm">
          <img
            src="/assets/logo-blue.png"
            alt="JMData"
            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
          />
          <JMBlueMark size={18} style={{ display: 'none' }} />
        </div>
        <span className="sb-name">
          <span className="jm">JMData</span>
          <span className="data"> Talent</span>
        </span>
        <button className="sb-toggle" onClick={toggleSidebar} title="Toggle sidebar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="sb-section">
        {!sidebarCollapsed && <div className="sb-section-label">Navigation</div>}
        {TABS.map(t => (
          <button
            key={t.id}
            className={`nav-item${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            title={t.label}
          >
            {t.icon}
            <span className="sb-label">{t.label}</span>
          </button>
        ))}
      </div>

      {file && (
        <div className="sb-file">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M8 1H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5L8 1z" stroke="currentColor" strokeWidth="1.2"/></svg>
          <span className="sb-file-name">{file}</span>
        </div>
      )}

      <div className="sb-bottom">
        <button className="action-btn" onClick={onRegenerate} title="Regenerate">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 7A5 5 0 1 1 7 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M7 2h3.5v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="sb-label">Regenerate</span>
        </button>
        <button className="action-btn" onClick={exportHTML} title="Export HTML">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v8M4 7l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          <span className="sb-label">Export HTML</span>
        </button>
        <button className="action-btn" onClick={exportPNG} title="Export PNG">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/><circle cx="5" cy="5" r="1" fill="currentColor"/><path d="M1.5 9l3-3 2.5 2.5L9.5 5.5l3 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="sb-label">Export PNG</span>
        </button>
        <button className="action-btn danger" onClick={goToLanding} title="New upload">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="sb-label">New Upload</span>
        </button>
      </div>
    </aside>
  );
}
