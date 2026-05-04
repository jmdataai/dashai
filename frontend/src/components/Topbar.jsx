import React, { useEffect, useState, useRef } from 'react';
import useStore from '../store';
import { apiGenerate, apiExportHtml } from '../api';
import { downloadBlob } from '../utils';
import { toast } from '../toast';

export default function Topbar() {
  const {
    dash, profile, file, theme, toggleTheme,
    filter, setFilter, clearFilter,
    did, setDash,
    filterLoading, setFilterLoading,
  } = useStore();

  const [clock, setClock] = useState('');
  const timerRef = useRef(null);

  const catCols = profile?.columns?.filter(c => c.semantic === 'categorical') || [];
  const valCol  = catCols.find(c => c.name === filter.col);
  const isFiltered = !!(dash?.filter?.col && dash?.filter?.val);

  // Clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  // Core filter apply — no LLM, uses stored plan on backend
  const runFilter = async (col, val) => {
    if (!did) return;
    setFilterLoading(true);
    try {
      // forceFresh=false → backend reuses stored plan, zero LLM calls
      const d = await apiGenerate(did, col || null, val || null, false);
      setDash(d);
      if (col && val) toast.success(`Filtered: ${col} = "${val}"`);
      else            toast.info('Filter cleared — showing all data');
    } catch (e) {
      toast.error('Filter failed: ' + e.message);
    } finally {
      setFilterLoading(false);
    }
  };

  // Column dropdown changed → reset value, don't call backend yet
  const onColChange = (col) => {
    clearTimeout(timerRef.current);
    setFilter(col || null, null);
  };

  // Value dropdown changed → immediately apply filter
  const onValChange = (val) => {
    clearTimeout(timerRef.current);
    setFilter(filter.col, val || null);
    if (val) {
      // Small debounce to avoid double-trigger on slow devices
      timerRef.current = setTimeout(() => runFilter(filter.col, val), 120);
    }
  };

  // Clear button → restore full dataset with same chart layout
  const onClear = () => {
    clearTimeout(timerRef.current);
    clearFilter();
    runFilter(null, null);
  };

  return (
    <header className="topbar">
      <div className="tb-left">
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <span>JMData Talent Dash</span>
          <span className="bc-sep">›</span>
          <span className="bc-current">{file || 'Dashboard'}</span>
        </div>

        {/* Filter bar — only shown when categorical columns exist */}
        {profile && catCols.length > 0 && (
          <div className="filter-bar">

            {/* Column selector */}
            <select
              className="filter-select"
              value={filter.col || ''}
              onChange={e => onColChange(e.target.value)}
              disabled={filterLoading}
            >
              <option value="">Filter by column…</option>
              {catCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>

            {/* Value selector — shown only after column picked */}
            {filter.col && valCol && (
              <select
                className="filter-select"
                value={filter.val || ''}
                onChange={e => onValChange(e.target.value)}
                disabled={filterLoading}
                size={1}
                style={{ maxWidth: 160 }}
              >
                <option value="">All values…</option>
                {valCol.sample_values?.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            )}

            {/* Active filter badge */}
            {isFiltered && !filterLoading && (
              <span className="filter-active-badge">
                {dash.filter.col}: {dash.filter.val}
              </span>
            )}

            {/* Applying indicator in topbar (subtle) */}
            {filterLoading && (
              <span className="filter-applying-txt">
                <span className="spin" style={{ width: 9, height: 9, flexShrink: 0 }} />
                Applying…
              </span>
            )}

            {/* Clear — shown when a column is picked or filter is active */}
            {(filter.col || isFiltered) && !filterLoading && (
              <button className="filter-clear" onClick={onClear}>✕ Clear</button>
            )}
          </div>
        )}
      </div>

      <div className="tb-right">
        {profile?.rows && (
          <span className="rows-badge">
            {isFiltered
              ? `Filtered · ${dash.filter.col} = ${dash.filter.val}`
              : `${profile.rows.toLocaleString()} rows`}
          </span>
        )}
        <button
          className="share-btn"
          title="Export & share as HTML"
          onClick={async () => {
            if (!dash) return;
            try {
              const blob = await apiExportHtml(dash);
              downloadBlob(blob, (dash.title || 'dashboard').replace(/\W+/g,'_') + '.html');
              toast.success('Dashboard exported! Share the HTML file.');
            } catch { toast.error('Export failed'); }
          }}
        >↑ Share</button>
        <button className="theme-btn" onClick={toggleTheme}>
          <span>{theme === 'dark' ? '🌙' : '☀️'}</span>
          <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
        </button>
        <span className="tb-clock">{clock}</span>
      </div>
    </header>
  );
}
