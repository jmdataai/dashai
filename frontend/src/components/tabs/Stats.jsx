import React from 'react';
import useStore from '../../store';

export default function Stats() {
  const { profile, file } = useStore();
  if (!profile?.columns?.length) return null;

  const cols    = profile.columns;
  const health  = profile.data_health || {};
  const outliers= profile.outlier_cols || [];

  const healthScore = (() => {
    let score = 100;
    if (health.duplicate_rows > 0)  score -= Math.min(20, health.duplicate_rows);
    if (health.total_nulls > 0)     score -= Math.min(20, Math.round(health.total_nulls / profile.rows * 100));
    if ((health.high_cardinality || []).length > 0) score -= 5;
    return Math.max(0, score);
  })();

  const scoreColor = healthScore >= 80 ? '#10b981' : healthScore >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div className="canvas">
      <div className="dash-hdr fade-up">
        <div className="dash-title">Column Statistics</div>
        <div className="dash-sub">{cols.length} usable columns · {profile.rows?.toLocaleString()} rows · {file}</div>
      </div>

      {/* ── Data Health Card ── */}
      <div className="health-card fade-up d1">
        <div className="health-card-left">
          <div className="health-score-ring" style={{'--score-color': scoreColor}}>
            <svg viewBox="0 0 56 56" width="56" height="56">
              <circle cx="28" cy="28" r="22" fill="none" stroke="var(--border)" strokeWidth="5"/>
              <circle cx="28" cy="28" r="22" fill="none" stroke={scoreColor} strokeWidth="5"
                strokeDasharray={`${healthScore * 1.382} 138.2`}
                strokeLinecap="round" transform="rotate(-90 28 28)" style={{transition:'stroke-dasharray 1s ease'}}/>
            </svg>
            <span className="health-score-val" style={{color: scoreColor}}>{healthScore}</span>
          </div>
          <div>
            <div className="health-title">Data Health Score</div>
            <div className="health-sub">{healthScore >= 80 ? 'Clean dataset' : healthScore >= 60 ? 'Minor issues found' : 'Review recommended'}</div>
          </div>
        </div>
        <div className="health-items">
          <div className={`health-item ${health.duplicate_rows > 0 ? 'warn' : 'ok'}`}>
            <span className="health-item-icon">{health.duplicate_rows > 0 ? '⚠' : '✓'}</span>
            <span>{health.duplicate_rows > 0 ? `${health.duplicate_rows} duplicate rows` : 'No duplicate rows'}</span>
          </div>
          <div className={`health-item ${health.total_nulls > 0 ? 'warn' : 'ok'}`}>
            <span className="health-item-icon">{health.total_nulls > 0 ? '⚠' : '✓'}</span>
            <span>{health.total_nulls > 0 ? `${health.total_nulls} null values across ${health.null_columns?.length} columns` : 'No missing values'}</span>
          </div>
          {(health.high_cardinality || []).length > 0 && (
            <div className="health-item warn">
              <span className="health-item-icon">ℹ</span>
              <span>High cardinality: {health.high_cardinality.join(', ')}</span>
            </div>
          )}
          {outliers.length > 0 && (
            <div className="health-item warn">
              <span className="health-item-icon">⚠</span>
              <span>Outliers detected: {outliers.map(o => `${o.col} (${o.count} rows, ${o.pct}%)`).join(' · ')}</span>
            </div>
          )}
          {outliers.length === 0 && (
            <div className="health-item ok">
              <span className="health-item-icon">✓</span>
              <span>No statistical outliers detected</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Column Stats Table ── */}
      <div className="table-wrap fade-up d2">
        <table className="data-table stats-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>Unique</th>
              <th>Nulls</th>
              <th>Min</th>
              <th>Max</th>
              <th>Mean</th>
              <th>Median</th>
              <th>Std Dev</th>
              <th>Sample Values</th>
            </tr>
          </thead>
          <tbody>
            {cols.map(col => {
              const tp      = col.semantic === 'numeric' ? 'n' : col.semantic === 'datetime' ? 'd' : 'c';
              const tpLabel = { n: 'Numeric', d: 'DateTime', c: 'Category' }[tp];
              const fmt     = v => v != null ? Number(v).toLocaleString(undefined, {maximumFractionDigits: 2}) : '—';
              return (
                <tr key={col.name}>
                  <td style={{ fontWeight: 600, color: 'var(--text)' }}>{col.name}</td>
                  <td><span className={`ct ct-${tp}`}>{tpLabel}</span></td>
                  <td className="mono-cell">{col.n_unique.toLocaleString()}</td>
                  <td className={`mono-cell${col.n_null > 0 ? ' warn-val' : ''}`}>{col.n_null.toLocaleString()}</td>
                  <td className="mono-cell">{fmt(col.min)}</td>
                  <td className="mono-cell">{fmt(col.max)}</td>
                  <td className="mono-cell">{fmt(col.mean)}</td>
                  <td className="mono-cell">{fmt(col.median)}</td>
                  <td className="mono-cell">{fmt(col.std)}</td>
                  <td className="sample-val">{(col.sample_values || []).slice(0, 3).join(', ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
