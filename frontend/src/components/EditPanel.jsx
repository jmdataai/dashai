import React, { useState, useEffect } from 'react';
import useStore from '../store';
import { apiChartUpdate } from '../api';
import { toast } from '../toast';

const CHART_TYPES = ['bar','line','area','scatter','pie','donut','histogram','box','heatmap','treemap','scatter3d','surface3d','animated_bar','animated_scatter'];
const AGG_OPTIONS  = ['sum','mean','count','max','min','none'];

export default function EditPanel() {
  const { editIdx, closeEdit, dash, did, profile, updateChart } = useStore();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ type:'bar', x:'', y:'', color:'', agg:'sum', title:'' });
  const isOpen = editIdx != null;
  const chart  = dash?.charts?.[editIdx];
  const cols   = profile?.columns || [];

  useEffect(() => {
    if (!chart) return;
    const s = chart.spec || {};
    setForm({
      type:  s.type  || chart.type || 'bar',
      x:     s.x     || '',
      y:     s.y     || '',
      color: s.color || '',
      agg:   s.agg   || 'sum',
      title: s.title || chart.title || '',
    });
  }, [editIdx, chart]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const apply = async () => {
    if (!chart || !did) return;
    setLoading(true);
    const spec = {
      ...form,
      x:     form.x     || null,
      y:     form.y     || null,
      color: form.color || null,
      id:    chart.id,
      span:  chart.span || 1,
    };
    try {
      const data = await apiChartUpdate(did, spec);
      updateChart(editIdx, { type: data.type, figure: data.figure, spec: data.spec, title: form.title || chart.title });
      toast.success('Chart updated!');
      closeEdit();
    } catch (e) {
      toast.error('Update failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const colOpts = (
    <option value="">— none —</option>
  );

  return (
    <>
      {isOpen && <div className="edit-overlay" onClick={closeEdit} />}
      <div className={`edit-panel${isOpen ? ' open' : ''}`}>
        <div className="ep-hd">
          <span className="ep-title">Edit Chart</span>
          <button className="ep-close" onClick={closeEdit}>✕</button>
        </div>
        <div className="ep-body">
          <label className="ep-label">Chart Type</label>
          <select className="ep-select" value={form.type} onChange={e => set('type', e.target.value)}>
            {CHART_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ').replace('3d','3D')}</option>)}
          </select>

          <label className="ep-label">X Axis</label>
          <select className="ep-select" value={form.x} onChange={e => set('x', e.target.value)}>
            <option value="">— none —</option>
            {cols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>

          <label className="ep-label">Y Axis</label>
          <select className="ep-select" value={form.y} onChange={e => set('y', e.target.value)}>
            <option value="">— none —</option>
            {cols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>

          <label className="ep-label">Color / Group By</label>
          <select className="ep-select" value={form.color} onChange={e => set('color', e.target.value)}>
            <option value="">— none —</option>
            {cols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>

          <label className="ep-label">Aggregation</label>
          <select className="ep-select" value={form.agg} onChange={e => set('agg', e.target.value)}>
            {AGG_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>

          <label className="ep-label">Chart Title</label>
          <input className="ep-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Chart title" />
        </div>
        <div className="ep-foot">
          <button className="ep-cancel" onClick={closeEdit}>Cancel</button>
          <button className="ep-apply" onClick={apply} disabled={loading}>
            {loading ? 'Applying…' : 'Apply Changes'}
          </button>
        </div>
      </div>
    </>
  );
}
