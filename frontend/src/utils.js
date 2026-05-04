export function fmtKPI(n, fmt) {
  try {
    const v = parseFloat(n);
    if (isNaN(v)) return String(n);
    if (fmt === 'currency') {
      if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
      if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
      if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
      return `$${v.toFixed(0)}`;
    }
    if (fmt === 'percent') return `${v.toFixed(1)}%`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  } catch { return String(n); }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Extract chart data from Plotly figure and download as CSV
export function downloadChartCSV(chart) {
  try {
    const traces = chart?.figure?.data || [];
    if (!traces.length) return false;

    const rows = [];
    traces.forEach((trace, ti) => {
      const name = trace.name || `Series ${ti + 1}`;
      const xs = trace.x || [];
      const ys = trace.y || [];
      const zs = trace.z || [];
      const labels = trace.labels || [];
      const values = trace.values || [];

      // Pie / Donut
      if (labels.length && values.length) {
        labels.forEach((l, i) => rows.push({ label: l, value: values[i] ?? '' }));
      }
      // Standard x/y trace
      else if (xs.length) {
        xs.forEach((x, i) => {
          const row = { series: name, x: x ?? '', y: ys[i] ?? '' };
          if (zs[i] !== undefined) row.z = zs[i];
          rows.push(row);
        });
      }
    });

    if (!rows.length) return false;

    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, (chart.title || 'chart').replace(/\W+/g, '_') + '.csv');
    return true;
  } catch { return false; }
}

// Zero-LLM heuristic: suggest an alternative chart type based on current type + data shape
export function suggestAltChartType(chart) {
  const t = chart.type || '';
  const spec = chart.spec || {};
  const nUnique = spec._x_nunique || 0;
  // Correlation heatmaps and 3D charts should never suggest switching
  const noSuggest = ['heatmap', 'scatter3d', 'surface3d', 'animated_bar', 'animated_scatter'];
  if (noSuggest.includes(t)) return null;
  const suggestions = {
    bar:       nUnique > 8 ? 'treemap' : 'donut',
    donut:     'bar',
    pie:       'bar',
    line:      'area',
    area:      'line',
    scatter:   'bar',
    histogram: 'box',
    box:       'histogram',
    treemap:   'bar',
    funnel:    'bar',
  };
  return suggestions[t] || null;
}

export const KPI_COLORS = ['#4468B0', '#22d3ee', '#10b981', '#f59e0b', '#a78bfa', '#f87171'];
export const KPI_ICONS  = ['💰', '📈', '🎯', '📦', '⚡', '🔢'];
