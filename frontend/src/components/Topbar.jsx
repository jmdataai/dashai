import React, { useEffect, useState, useRef } from 'react';
import useStore from '../store';
import { apiGenerate } from '../api';
import { toast } from '../toast';

export default function Topbar() {
  const { dash, profile, file, theme, toggleTheme, filter, setFilter, clearFilter, did, setDash } = useStore();
  const [clock, setClock]       = useState('');
  const [applying, setApplying] = useState(false);
  const applyTimer = useRef(null);

  const catCols = profile?.columns?.filter(c => c.semantic === 'categorical') || [];
  const valCol  = catCols.find(c => c.name === filter.col);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }));
    tick(); const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  const applyFilter = async (col, val) => {
    if (!did || !col || !val) return;
    clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(async () => {
      setApplying(true);
      try {
        const d = await apiGenerate(did, col, val);
        setDash(d);
        toast.success(`Filtered: ${col} = "${val}"`);
      } catch (e) {
        toast.error('Filter failed: ' + e.message);
      } finally { setApplying(false); }
    }, 300);
  };

  const handleClearFilter = async () => {
    clearFilter();
    if (!did) return;
    setApplying(true);
    try {
      const d = await apiGenerate(did);
      setDash(d);
      toast.info('Filter cleared — showing all data');
    } catch (e) {
      toast.error('Reset failed: ' + e.message);
    } finally { setApplying(false); }
  };

  const onColChange = (col) => setFilter(col || null, null);
  const onValChange = (val) => { setFilter(filter.col, val || null); if (val) applyFilter(filter.col, val); };
  const isFiltered = !!(dash?.filter?.col && dash?.filter?.val);

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
            <select className="filter-select" value={filter.col || ''} onChange={e => onColChange(e.target.value)} disabled={applying}>
              <option value="">Filter by column…</option>
              {catCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>

            {filter.col && valCol && (
              <select className="filter-select" value={filter.val || ''} onChange={e => onValChange(e.target.value)} disabled={applying}>
                <option value="">All values…</option>
                {valCol.sample_values?.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            )}

            {applying && (
              <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--muted)' }}>
                <div className="spin" style={{ width:10, height:10 }} /><span>Applying…</span>
              </div>
            )}

            {isFiltered && !applying && (
              <span style={{ fontSize:10, fontWeight:700, padding:'3px 8px', background:'rgba(59,130,246,0.12)', border:'1px solid rgba(59,130,246,0.3)', borderRadius:6, color:'var(--accent2)', whiteSpace:'nowrap' }}>
                {dash.filter.col}: {dash.filter.val}
              </span>
            )}

            {(filter.col || isFiltered) && !applying && (
              <button className="filter-clear" onClick={handleClearFilter}>✕ Clear</button>
            )}
          </div>
        )}
      </div>

      <div className="tb-right">
        {dash?.provider && <span className="provider-badge">{dash.provider}</span>}
        {profile?.rows && (
          <span className="rows-badge">
            {isFiltered ? `filtered data` : `${profile.rows.toLocaleString()} rows`}
          </span>
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
