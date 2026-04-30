import React, { useState, useRef, useEffect } from 'react';
import PlotlyChart from './PlotlyChart';
import useStore from '../store';
import { toast } from '../toast';

export default function ChartCard({ chart, idx, height = '360px' }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const { openEdit, openFullscreen, deleteChart, duplicateChart } = useStore();

  const is3D   = ['scatter3d','surface3d'].includes(chart.type);
  const isAnim = ['animated_bar','animated_scatter'].includes(chart.type);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const downloadPNG = () => {
    setMenuOpen(false);
    const el = document.getElementById(`plt-${idx}`);
    if (!el) return;
    try {
      window.Plotly.downloadImage(el, { format: 'png', scale: 2, filename: (chart.title || 'chart').replace(/\W+/g, '_'), width: 1200, height: 600 });
      toast.info('Downloading PNG…');
    } catch { toast.error('PNG download failed'); }
  };

  return (
    <div className="chart-card">
      <div className="chart-hd">
        <div className="chart-hd-left">
          <span className="chart-title">{chart.title || ''}</span>
          <span className="chart-badge">{chart.type || 'chart'}</span>
          {is3D   && <span className="chart-badge b3d">3D</span>}
          {isAnim && <span className="chart-badge banim">▶ Animated</span>}
        </div>
        <div className="menu-wrap" ref={menuRef}>
          <button className="menu-btn" onClick={() => setMenuOpen(o => !o)}>⋮</button>
          {menuOpen && (
            <div className="ctx-menu">
              <button onClick={() => { setMenuOpen(false); openEdit(idx); }}>✎ Edit Chart</button>
              <button onClick={() => { setMenuOpen(false); openFullscreen(idx); }}>⛶ Fullscreen</button>
              <button onClick={downloadPNG}>↓ Download PNG</button>
              <button onClick={() => { setMenuOpen(false); duplicateChart(idx); toast.info('Chart duplicated'); }}>⧉ Duplicate</button>
              <button className="danger" onClick={() => { setMenuOpen(false); deleteChart(idx); toast.info('Chart removed'); }}>✕ Remove</button>
            </div>
          )}
        </div>
      </div>
      {chart.subtitle && <div className="chart-sub">{chart.subtitle}</div>}
      <div id={`plt-${idx}`}>
        <PlotlyChart chart={chart} height={height} />
      </div>
    </div>
  );
}
