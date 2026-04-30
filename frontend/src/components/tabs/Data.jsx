import React, { useState, useMemo } from 'react';
import useStore from '../../store';
import { toast } from '../../toast';

export default function Data() {
  const { profile, file } = useStore();
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  const rows = profile?.preview || [];
  const cols = rows.length ? Object.keys(rows[0]) : [];

  const filtered = useMemo(() => {
    let r = rows;
    if (search) {
      const q = search.toLowerCase();
      r = r.filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(q)));
    }
    if (sortCol) {
      r = [...r].sort((a, b) => {
        const av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
        const an = parseFloat(av), bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn)) return sortAsc ? an - bn : bn - an;
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }
    return r;
  }, [rows, search, sortCol, sortAsc]);

  const handleSort = (col) => {
    if (sortCol === col) { setSortAsc(a => !a); } else { setSortCol(col); setSortAsc(true); }
  };

  const exportCSV = () => {
    if (!rows.length) return;
    const csv = [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (file || 'data').replace(/\.[^.]+$/, '') + '_preview.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast.success('CSV exported!');
  };

  if (!rows.length) return (
    <div className="canvas"><div style={{ padding: '40px', color: 'var(--muted)', textAlign: 'center' }}>No data preview available</div></div>
  );

  return (
    <div className="canvas">
      <div className="dash-hdr fade-up">
        <div className="dash-title">Data Preview</div>
        <div className="table-toolbar">
          <input className="table-search" type="text" placeholder="Search rows…" value={search} onChange={e => setSearch(e.target.value)} />
          <button className="export-btn" onClick={exportCSV}>↓ Export CSV</button>
          <span className="dt-count">{filtered.length} of {profile?.rows?.toLocaleString()} rows</span>
        </div>
      </div>

      <div className="table-wrap fade-up d1">
        <table className="data-table">
          <thead>
            <tr>
              {cols.map(col => (
                <th key={col} onClick={() => handleSort(col)}>
                  {col}
                  <span className="sort-icon">
                    {sortCol === col ? (sortAsc ? '↑' : '↓') : '⇅'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, ri) => (
              <tr key={ri}>
                {cols.map(col => {
                  let val = String(row[col] ?? '');
                  if (val.length > 60) val = val.slice(0, 57) + '…';
                  return <td key={col} title={String(row[col] || '')}>{val}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
