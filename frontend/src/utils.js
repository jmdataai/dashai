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

export const KPI_COLORS = ['#06b6d4', '#a78bfa', '#10b981', '#f59e0b', '#3b82f6', '#f87171'];
export const KPI_ICONS  = ['💰', '📈', '🎯', '📦', '⚡', '🔢'];
