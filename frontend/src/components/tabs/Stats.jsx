import React from 'react';
import useStore from '../../store';

export default function Stats() {
  const { profile, file } = useStore();
  if (!profile?.columns?.length) return null;

  return (
    <div className="canvas">
      <div className="dash-hdr fade-up">
        <div className="dash-title">Column Statistics</div>
        <div className="dash-sub">{profile.columns.length} usable columns from {file}</div>
      </div>

      <div className="table-wrap fade-up d1">
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
              <th>Sample Values</th>
            </tr>
          </thead>
          <tbody>
            {profile.columns.map(col => {
              const tp = col.semantic === 'numeric' ? 'n' : col.semantic === 'datetime' ? 'd' : 'c';
              const tpLabel = { n: 'Numeric', d: 'DateTime', c: 'Category' }[tp];
              return (
                <tr key={col.name}>
                  <td style={{ fontWeight: 600, fontFamily: 'var(--font)', color: 'var(--text)' }}>{col.name}</td>
                  <td><span className={`ct ct-${tp}`}>{tpLabel}</span></td>
                  <td className="mono-cell">{col.n_unique.toLocaleString()}</td>
                  <td className={`mono-cell${col.n_null > 0 ? ' warn-val' : ''}`}>{col.n_null.toLocaleString()}</td>
                  <td className="mono-cell">{col.min != null ? Number(col.min).toFixed(2) : '—'}</td>
                  <td className="mono-cell">{col.max != null ? Number(col.max).toFixed(2) : '—'}</td>
                  <td className="mono-cell">{col.mean != null ? Number(col.mean).toFixed(2) : '—'}</td>
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
