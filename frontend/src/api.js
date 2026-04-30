const API = window.DASHAI_API || 'http://localhost:7860';
const timeout = (ms) => AbortSignal.timeout(ms);

export async function apiHealth() {
  const r = await fetch(`${API}/health`, { signal: timeout(7000) });
  return r.json();
}

export async function apiUpload(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch(`${API}/api/upload`, { method: 'POST', body: fd, signal: timeout(30000) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || 'Upload failed'); }
  return r.json();
}

export async function apiSample(name = 'sales') {
  const r = await fetch(`${API}/api/sample/${name}`, { method: 'POST', signal: timeout(30000) });
  if (!r.ok) throw new Error('Sample load failed');
  return r.json();
}

// forceFresh=true  → Regenerate button  → calls LLM
// forceFresh=false → filter apply/clear  → reuses stored plan, zero LLM calls
export async function apiGenerate(did, filterCol = null, filterVal = null, forceFresh = false) {
  const body = {};
  if (filterCol && filterVal) { body.filter_col = filterCol; body.filter_val = filterVal; }
  if (forceFresh) body.force_fresh = true;
  const r = await fetch(`${API}/api/generate/${did}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: timeout(90000),
  });
  if (!r.ok) throw new Error('Generation failed: ' + r.status);
  return r.json();
}

export async function apiChartUpdate(did, spec) {
  const r = await fetch(`${API}/api/chart/update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ did, spec }), signal: timeout(30000),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || 'Update failed'); }
  return r.json();
}

export async function apiChat(did, message, currentCharts, history) {
  const r = await fetch(`${API}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      did, message,
      current_charts: currentCharts.map(ch => ({ id: ch.id, type: ch.type, title: ch.title, spec: ch.spec })),
      history: history.slice(-6),
    }),
    signal: timeout(30000),
  });
  if (!r.ok) throw new Error('Chat failed');
  return r.json();
}

export async function apiExportHtml(dashboard) {
  const r = await fetch(`${API}/api/export/html`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dashboard }), signal: timeout(30000),
  });
  if (!r.ok) throw new Error('Export failed');
  return r.blob();
}
