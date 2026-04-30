import React from 'react';
import useStore from '../../store';

export default function Insights() {
  const { dash, profile } = useStore();
  if (!dash || !profile) return null;

  const cols     = profile.columns || [];
  const nullCols = cols.filter(c => c.n_null > 0);
  const numCols  = cols.filter(c => c.semantic === 'numeric');
  const catCols  = cols.filter(c => c.semantic === 'categorical');
  const dtCols   = cols.filter(c => c.semantic === 'datetime');
  const typeCounts = {};
  (dash.charts || []).forEach(ch => { typeCounts[ch.type] = (typeCounts[ch.type] || 0) + 1; });

  return (
    <div className="canvas">
      <div className="dash-hdr fade-up">
        <div className="dash-title">AI Insights</div>
        <div className="dash-sub">Automated analysis of your dataset</div>
      </div>

      {/* Key findings */}
      {dash.insights?.length > 0 && (
        <div className="ins-card fade-up">
          <div className="ins-card-hd"><span>✦</span> Key Findings</div>
          <ul className="ins-list">
            {dash.insights.map((ins, i) => <li key={i} className="ins-item">{ins}</li>)}
          </ul>
        </div>
      )}

      {/* Data profile */}
      <div className="ins-card fade-up d1">
        <div className="ins-card-hd"><span>◎</span> Data Profile</div>
        <div className="ins-stat-grid">
          <div className="ins-stat">
            <div className="ins-stat-val">{profile.rows.toLocaleString()}</div>
            <div className="ins-stat-lbl">Total Rows</div>
          </div>
          <div className="ins-stat">
            <div className="ins-stat-val">{numCols.length}</div>
            <div className="ins-stat-lbl">Numeric Cols</div>
          </div>
          <div className="ins-stat">
            <div className="ins-stat-val">{catCols.length}</div>
            <div className="ins-stat-lbl">Category Cols</div>
          </div>
          <div className="ins-stat">
            <div className="ins-stat-val">{dtCols.length}</div>
            <div className="ins-stat-lbl">Date Cols</div>
          </div>
          <div className={`ins-stat ${nullCols.length ? 'warn' : 'ok'}`}>
            <div className="ins-stat-val">{nullCols.length}</div>
            <div className="ins-stat-lbl">Cols with Nulls</div>
          </div>
          <div className="ins-stat">
            <div className="ins-stat-val">{dash.charts?.length || 0}</div>
            <div className="ins-stat-lbl">Charts Generated</div>
          </div>
        </div>
        {nullCols.length > 0 && (
          <div className="ins-null-warn">⚠ Columns with missing values: {nullCols.map(c => c.name).join(', ')}</div>
        )}
      </div>

      {/* Chart type summary */}
      {Object.keys(typeCounts).length > 0 && (
        <div className="ins-card fade-up d2">
          <div className="ins-card-hd"><span>▣</span> Charts Generated</div>
          <div className="ins-chips">
            {Object.entries(typeCounts).map(([t, n]) => (
              <span key={t} className="ins-chip">{t} <span className="ins-chip-count">×{n}</span></span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
