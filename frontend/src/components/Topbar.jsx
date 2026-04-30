import React, { useEffect, useState } from 'react';
import useStore from '../store';

export default function Topbar() {
  const { dash, profile, file, theme, toggleTheme, filter, setFilter, clearFilter } = useStore();
  const [clock, setClock] = useState('');
  const catCols = profile?.columns?.filter(c => c.semantic === 'categorical') || [];
  const valCol  = catCols.find(c => c.name === filter.col);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }));
    tick(); const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="topbar">
      <div className="tb-left">
        <div className="breadcrumb">
          <span>DashAI</span>
          <span className="bc-sep">›</span>
          <span className="bc-current">{file || 'Dashboard'}</span>
        </div>

        {profile && catCols.length > 0 && (
          <div className="filter-bar">
            <select
              className="filter-select"
              value={filter.col || ''}
              onChange={e => setFilter(e.target.value || null, null)}
            >
              <option value="">Filter by column…</option>
              {catCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>

            {filter.col && valCol && (
              <select
                className="filter-select"
                value={filter.val || ''}
                onChange={e => setFilter(filter.col, e.target.value || null)}
              >
                <option value="">All values</option>
                {valCol.sample_values?.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            )}

            {(filter.col || filter.val) && (
              <button className="filter-clear" onClick={clearFilter}>✕ Clear</button>
            )}
          </div>
        )}
      </div>

      <div className="tb-right">
        {dash?.provider && (
          <span className="provider-badge">{dash.provider}</span>
        )}
        {profile?.rows && (
          <span className="rows-badge">{profile.rows.toLocaleString()} rows</span>
        )}
        <button className="theme-btn" onClick={toggleTheme}>
          <span>{theme === 'dark' ? '🌙' : '☀️'}</span>
          <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
        </button>
        <span className="tb-clock">{clock}</span>
      </div>
    </header>
  );
}
