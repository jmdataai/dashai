"use strict";
const API = window.DASHAI_API || "http://localhost:7860";

// ── State ─────────────────────────────────────────────────────
const S = { did: null, dash: null, file: "", profile: null, genTimer: null, editIdx: null, filter: { col: null, val: null } };
const CHAT = { open: false, history: [], counter: 0 };
let dtSortCol = null, dtSortAsc = true;

// ── Theme ─────────────────────────────────────────────────────
const T = { mode: 'dark' };
function toggleTheme() { T.mode = T.mode === 'dark' ? 'light' : 'dark'; applyTheme(); }
function applyTheme() {
  const isDark = T.mode === 'dark';
  document.body.classList.toggle('light', !isDark);
  const icon = isDark ? '🌙' : '☀️', label = isDark ? 'Dark' : 'Light';
  ['land','dash'].forEach(id => {
    const i = document.getElementById('theme-icon-' + id), l = document.getElementById('theme-label-' + id);
    if (i) i.textContent = icon; if (l) l.textContent = label;
  });
  setTimeout(() => { document.querySelectorAll('[id^="plt-"]').forEach(div => { try { Plotly.Plots.resize(div); } catch {} }); }, 200);
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  const fi = document.getElementById("file-input");
  fi.addEventListener("change", e => e.target.files[0] && handleUpload(e.target.files[0]));
  const da = document.getElementById("drop-area");
  da.addEventListener("dragover", e => { e.preventDefault(); da.classList.add("over"); });
  da.addEventListener("dragleave", () => da.classList.remove("over"));
  da.addEventListener("drop", e => { e.preventDefault(); da.classList.remove("over"); e.dataTransfer.files[0] && handleUpload(e.dataTransfer.files[0]); });
  updateClock(); setInterval(updateClock, 30000);
  // Close chart menus on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.chart-menu-wrap')) {
      document.querySelectorAll('.chart-menu.open').forEach(m => m.classList.remove('open'));
    }
  });
});

// ── Keyboard shortcuts ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeEditPanel(); closeFullscreen();
    if (document.getElementById('chat-panel')?.classList.contains('open')) toggleChat();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); toggleChat(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'r' && S.did) { e.preventDefault(); doGenerate(); }
});

function updateClock() {
  const el = document.getElementById("tb-time");
  if (el) el.textContent = new Date().toLocaleString("en-US", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}

async function checkHealth() {
  const dot = document.querySelector(".status-dot"), txt = document.querySelector(".status-txt");
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(7000) });
    if (r.ok) {
      const d = await r.json();
      const ok = Object.values(d.providers||{}).some(v=>v);
      dot.classList.add(ok ? "on" : "warn");
      txt.textContent = ok ? "AI Engine Online" : "No API keys";
    }
  } catch { if (txt) txt.textContent = "Offline"; }
}

// ── Upload ────────────────────────────────────────────────────
async function handleUpload(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["csv","xlsx","xls"].includes(ext)) { showToast("Upload CSV or Excel files only.", "error"); return; }
  clearErr(); S.did = null; S.file = file.name;
  setSt("Uploading & analyzing columns…");
  try {
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch(`${API}/api/upload`, { method:"POST", body:fd, signal:AbortSignal.timeout(30000) });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.detail || "Upload failed"); }
    const data = await r.json();
    S.did = data.id; S.profile = data;
    showFileInfo(data); renderChips(data.columns); clearSt();
    document.getElementById("gen-btn").disabled = false;
    doGenerate();
  } catch (e) { clearSt(); showErr(e.message); }
}

async function loadSample(name) {
  clearErr(); setSt("Loading sample…");
  try {
    const r = await fetch(`${API}/api/sample/${name}`, { method:"POST" });
    if (!r.ok) throw new Error("Sample load failed");
    const data = await r.json();
    S.did = data.id; S.file = data.filename; S.profile = data;
    showFileInfo(data); renderChips(data.columns); clearSt();
    document.getElementById("gen-btn").disabled = false;
    doGenerate();
  } catch (e) { clearSt(); showErr(e.message); }
}

// ── Generate ──────────────────────────────────────────────────
async function doGenerate() {
  if (!S.did) return;
  clearErr(); showOverlay();
  try {
    const r = await fetch(`${API}/api/generate/${S.did}`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:"{}", signal:AbortSignal.timeout(90000)
    });
    if (!r.ok) throw new Error("Generation failed: " + r.status);
    S.dash = await r.json();
  } catch (e) { hideOverlay(); showToast("Generation failed: " + e.message, "error"); return; }
  hideOverlay();

  document.getElementById("page-upload").style.display = "none";
  document.getElementById("page-dash").classList.add("show");
  document.getElementById("tb-filename").textContent = S.file;
  document.getElementById("sb-filename").textContent = S.file;

  // Provider badge
  const provEl = document.getElementById("tb-provider");
  if (provEl && S.dash.provider) {
    provEl.textContent = S.dash.provider;
    provEl.style.display = "inline-flex";
  }

  // Row count
  const rowsEl = document.getElementById("tb-rows-count");
  if (rowsEl && S.profile) rowsEl.textContent = S.profile.rows?.toLocaleString() + " rows";

  // Filter bar
  const filterBar = document.getElementById("tb-filter-bar");
  if (filterBar && S.profile) {
    filterBar.style.display = "flex";
    const colSel = document.getElementById("filter-col");
    colSel.innerHTML = '<option value="">Filter by column…</option>';
    (S.profile.columns || []).filter(c => c.semantic === "categorical").forEach(c => {
      const opt = document.createElement("option"); opt.value = c.name; opt.textContent = c.name; colSel.appendChild(opt);
    });
  }

  // Show chat bubble
  document.body.classList.add('dash-active');

  // Render all tabs
  renderOverview(S.dash);
  renderChartsTab(S.dash);
  renderInsightsTab(S.dash);
  renderStatsTab();
  renderDataTab();
  switchTab("overview", document.querySelector('[data-tab="overview"]'));

  // Chat suggestions
  renderChatSuggestions();

  showToast("Dashboard generated!", "success");
}

// ── Overlay ───────────────────────────────────────────────────
function showOverlay() {
  const ov = document.getElementById("gen-overlay"); ov.classList.add("show");
  const steps = ["Analyzing dataset…","Profiling columns…","AI selecting charts…","Building visualizations…","Assembling dashboard…"];
  let si = 0, pct = 0;
  const label = document.getElementById("gen-text"), bar = document.getElementById("gen-fill");
  label.textContent = steps[0]; bar.style.width = "3%";
  S.genTimer = setInterval(() => {
    si = (si+1) % steps.length;
    pct = Math.min(92, pct + 16 + Math.random()*8);
    label.textContent = steps[si]; bar.style.width = pct + "%";
  }, 1500);
}
function hideOverlay() {
  clearInterval(S.genTimer);
  document.getElementById("gen-fill").style.width = "100%";
  setTimeout(() => {
    document.getElementById("gen-overlay").classList.remove("show");
    document.getElementById("gen-fill").style.width = "0%";
  }, 300);
}

// ── Sidebar ───────────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("collapsed");
  setTimeout(() => { document.querySelectorAll("[id^='plt-']").forEach(div => { try { Plotly.Plots.resize(div); } catch {} }); }, 300);
}

// ── Tabs ──────────────────────────────────────────────────────
function switchTab(tab, btn) {
  document.querySelectorAll(".sb-item").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  const panel = document.getElementById("tab-" + tab);
  if (panel) panel.classList.add("active");
  if (tab === "overview" || tab === "charts") {
    setTimeout(() => { document.querySelectorAll("[id^='plt-']").forEach(div => { try { Plotly.Plots.resize(div); } catch {} }); }, 100);
  }
}

// ── Render: Overview ──────────────────────────────────────────
function renderOverview(d) {
  const c = document.getElementById("overview-canvas"); c.innerHTML = "";
  const hdr = el("div","dash-hdr fade-up");
  hdr.innerHTML = `<div class="dash-title">${d.title||"Dashboard"}</div><div class="dash-sub">${d.subtitle||""}</div>`;
  c.appendChild(hdr);

  // KPIs with real trend
  if (d.kpis?.length) {
    const g = el("div","kpi-grid");
    const colors = ["#00d4e8","#9b7aff","#00c48c","#ffb020","#4f6df5","#ff5c6a"];
    const icons  = ["💰","📈","🎯","📦","⚡","🔢"];
    d.kpis.forEach((k, i) => {
      const card = el("div","kpi-card");
      card.style.setProperty("--kc", colors[i%colors.length]);
      const val = k.formatted_value || fmtKPI(k.value, k.format);
      let trendHtml = "";
      if (k.trend_pct != null) {
        const trendCls = k.trend_pct > 0 ? "up" : k.trend_pct < 0 ? "down" : "neutral";
        const trendArrow = k.trend_pct > 0 ? "↑" : k.trend_pct < 0 ? "↓" : "→";
        trendHtml = `<div class="kpi-trend ${trendCls}">${trendArrow} ${Math.abs(k.trend_pct)}%</div>`;
      }
      card.innerHTML = `
        <div class="kpi-hd"><div class="kpi-lbl">${k.label}</div><div class="kpi-ico">${icons[i%icons.length]}</div></div>
        <div class="kpi-val">${val}</div>
        <div class="kpi-sub">${k.column ? k.metric + " of " + k.column : "total records"}</div>
        ${trendHtml}`;
      g.appendChild(card);
    });
    c.appendChild(g);
  }

  // AI Insights box
  if (d.insights?.length) {
    const box = el("div","insights-box fade-up");
    box.innerHTML = `
      <div class="ins-box-header"><span class="ins-box-icon">✦</span>AI Insights</div>
      <ul class="ins-box-list">${d.insights.map(i => `<li class="ins-box-item">${i}</li>`).join('')}</ul>`;
    c.appendChild(box);
  }

  // Charts
  const charts = d.charts || [];
  const hero = charts.find(ch => ch.span >= 2) || charts[0];
  const subs = charts.filter(ch => ch !== hero);
  if (hero) {
    const row = el("div","hero-row fade-up d1");
    row.appendChild(makeChartCard(hero, 0, "420px"));
    c.appendChild(row);
  }
  if (subs.length) {
    const grid = el("div","chart-grid fade-up d2");
    subs.forEach((ch, i) => grid.appendChild(makeChartCard(ch, i+1, "310px")));
    c.appendChild(grid);
  }
  c.appendChild(mkFooter(d));
  setTimeout(() => plotAll(charts), 140);
}

// ── Render: Charts tab ────────────────────────────────────────
function renderChartsTab(d) {
  const c = document.getElementById("charts-canvas"); c.innerHTML = "";
  const hdr = el("div","dash-hdr");
  hdr.innerHTML = `<div class="dash-title">All Charts</div><div class="dash-sub">${(d.charts||[]).length} visualizations generated</div>`;
  c.appendChild(hdr);
  const wrap = el("div","charts-full-grid");
  (d.charts||[]).forEach((ch, i) => wrap.appendChild(makeChartCard(ch, 100+i, "440px")));
  c.appendChild(wrap);
  setTimeout(() => {
    (d.charts||[]).forEach((ch, i) => {
      const div = document.getElementById("plt-" + (100+i));
      if (!div || !ch.figure) return;
      plotOne(div, ch);
    });
  }, 200);
}

// ── Render: Insights tab ──────────────────────────────────────
function renderInsightsTab(d) {
  const c = document.getElementById("insights-canvas"); c.innerHTML = "";

  const hdr = el("div","dash-hdr");
  hdr.innerHTML = `<div class="dash-title">AI Insights</div><div class="dash-sub">Automated analysis of your dataset</div>`;
  c.appendChild(hdr);

  if (d.insights?.length) {
    const card = el("div","ins-card fade-up");
    card.innerHTML = `<div class="ins-card-header"><span class="ins-icon">✦</span>Key Findings</div>
      <ul class="ins-list">${d.insights.map(i=>`<li class="ins-item">${i}</li>`).join('')}</ul>`;
    c.appendChild(card);
  }

  if (S.profile) {
    const qcard = el("div","ins-card fade-up d1");
    const cols = S.profile.columns || [];
    const nullCols = cols.filter(c => c.n_null > 0);
    const numCols  = cols.filter(c => c.semantic === "numeric");
    const catCols  = cols.filter(c => c.semantic === "categorical");
    const dtCols   = cols.filter(c => c.semantic === "datetime");
    qcard.innerHTML = `
      <div class="ins-card-header"><span class="ins-icon">◎</span>Data Profile</div>
      <div class="ins-stat-grid">
        <div class="ins-stat"><div class="ins-stat-val">${S.profile.rows.toLocaleString()}</div><div class="ins-stat-lbl">Total Rows</div></div>
        <div class="ins-stat"><div class="ins-stat-val">${numCols.length}</div><div class="ins-stat-lbl">Numeric Cols</div></div>
        <div class="ins-stat"><div class="ins-stat-val">${catCols.length}</div><div class="ins-stat-lbl">Category Cols</div></div>
        <div class="ins-stat"><div class="ins-stat-val">${dtCols.length}</div><div class="ins-stat-lbl">Date Cols</div></div>
        <div class="ins-stat ${nullCols.length ? 'warn' : 'ok'}">
          <div class="ins-stat-val">${nullCols.length}</div>
          <div class="ins-stat-lbl">Cols with Nulls</div>
        </div>
        <div class="ins-stat"><div class="ins-stat-val">${d.charts?.length||0}</div><div class="ins-stat-lbl">Charts Generated</div></div>
      </div>
      ${nullCols.length ? `<div class="ins-null-warn">⚠ Columns with missing values: ${nullCols.map(c=>c.name).join(', ')}</div>` : ''}`;
    c.appendChild(qcard);
  }

  if (d.charts?.length) {
    const typeCounts = {};
    d.charts.forEach(ch => typeCounts[ch.type] = (typeCounts[ch.type]||0)+1);
    const tcard = el("div","ins-card fade-up d2");
    tcard.innerHTML = `
      <div class="ins-card-header"><span class="ins-icon">▣</span>Charts Generated</div>
      <div class="ins-type-chips">${Object.entries(typeCounts).map(([t,n])=>
        `<span class="ins-type-chip">${t} <span class="ins-type-count">×${n}</span></span>`).join('')}</div>`;
    c.appendChild(tcard);
  }
}

// ── Render: Stats tab ─────────────────────────────────────────
function renderStatsTab() {
  const c = document.getElementById("stats-canvas"); c.innerHTML = "";
  if (!S.profile?.columns?.length) return;

  const hdr = el("div","dash-hdr");
  hdr.innerHTML = `<div class="dash-title">Column Statistics</div><div class="dash-sub">${S.profile.columns.length} usable columns from ${S.file}</div>`;
  c.appendChild(hdr);

  const wrap = el("div","data-table-wrap");
  let html = `<table class="data-table stats-table"><thead><tr>
    <th>Column</th><th>Type</th><th>Unique</th><th>Nulls</th>
    <th>Min</th><th>Max</th><th>Mean</th><th>Sample Values</th>
  </tr></thead><tbody>`;
  S.profile.columns.forEach(col => {
    const tp = col.semantic === "numeric" ? "n" : col.semantic === "datetime" ? "d" : "c";
    const tpLabel = {"n":"Numeric","d":"DateTime","c":"Category"}[tp];
    html += `<tr>
      <td><strong>${col.name}</strong></td>
      <td><span class="ct ct-${tp}">${tpLabel}</span></td>
      <td class="mono">${col.n_unique.toLocaleString()}</td>
      <td class="mono ${col.n_null > 0 ? 'warn-text' : ''}">${col.n_null.toLocaleString()}</td>
      <td class="mono">${col.min != null ? Number(col.min).toFixed(2) : '—'}</td>
      <td class="mono">${col.max != null ? Number(col.max).toFixed(2) : '—'}</td>
      <td class="mono">${col.mean != null ? Number(col.mean).toFixed(2) : '—'}</td>
      <td class="sample-vals">${(col.sample_values||[]).slice(0,3).join(', ')}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
  c.appendChild(wrap);
}

// ── Render: Data tab (sortable + search) ──────────────────────
function renderDataTab() {
  const c = document.getElementById("data-canvas"); c.innerHTML = "";
  const preview = S.profile?.preview;
  if (!preview || !preview.length) {
    c.innerHTML = '<div style="padding:40px;color:var(--muted);text-align:center">No data preview available</div>'; return;
  }

  const hdr = el("div","dash-hdr");
  hdr.innerHTML = `<div class="dash-title">Data Preview</div>
    <div class="dt-toolbar">
      <input class="dt-search" id="dt-search" type="text" placeholder="Search rows…" oninput="filterDataTable()" />
      <button class="dt-export-btn" onclick="exportCSV()">↓ CSV</button>
    </div>
    <div class="dash-sub" id="dt-rowcount">Showing ${preview.length} of ${S.profile.rows.toLocaleString()} rows</div>`;
  c.appendChild(hdr);

  const wrap = el("div","data-table-wrap"); wrap.id = "dt-wrap";
  const cols = Object.keys(preview[0]);
  let html = '<table class="data-table" id="dt-table"><thead><tr>';
  cols.forEach(col => {
    html += `<th onclick="sortDataTable('${col}')" style="cursor:pointer">${col} <span class="sort-icon" id="sort-${col}">⇅</span></th>`;
  });
  html += '</tr></thead><tbody id="dt-body">';
  preview.forEach(row => {
    html += '<tr>';
    cols.forEach(col => {
      let val = String(row[col] ?? "");
      if (val.length > 60) val = val.slice(0,57) + "…";
      html += `<td title="${String(row[col]||"").replace(/"/g,"&quot;")}">${val}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
  c.appendChild(wrap);
}

function filterDataTable() {
  const q = (document.getElementById('dt-search')?.value || "").toLowerCase();
  const tbody = document.getElementById('dt-body');
  if (!tbody) return;
  let shown = 0;
  Array.from(tbody.rows).forEach(row => {
    const match = Array.from(row.cells).some(cell => cell.textContent.toLowerCase().includes(q));
    row.style.display = match ? "" : "none";
    if (match) shown++;
  });
  const rc = document.getElementById('dt-rowcount');
  if (rc) rc.textContent = `Showing ${shown} of ${S.profile?.rows?.toLocaleString()||0} rows`;
}

function sortDataTable(col) {
  if (dtSortCol === col) { dtSortAsc = !dtSortAsc; } else { dtSortCol = col; dtSortAsc = true; }
  // Update sort icons
  document.querySelectorAll('.sort-icon').forEach(s => s.textContent = '⇅');
  const icon = document.getElementById('sort-' + col);
  if (icon) icon.textContent = dtSortAsc ? '↑' : '↓';

  const tbody = document.getElementById('dt-body');
  if (!tbody) return;
  const rows = Array.from(tbody.rows).filter(r => r.style.display !== 'none');
  const colIndex = Array.from(tbody.closest('table').querySelectorAll('th')).findIndex(th => th.textContent.trim().startsWith(col));
  if (colIndex < 0) return;
  rows.sort((a, b) => {
    const av = a.cells[colIndex]?.textContent || "", bv = b.cells[colIndex]?.textContent || "";
    const an = parseFloat(av), bn = parseFloat(bv);
    if (!isNaN(an) && !isNaN(bn)) return dtSortAsc ? an - bn : bn - an;
    return dtSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  rows.forEach(r => tbody.appendChild(r));
}

// ── Filter bar ────────────────────────────────────────────────
function onFilterColChange() {
  const col = document.getElementById('filter-col').value;
  const valSel = document.getElementById('filter-val');
  valSel.innerHTML = '<option value="">All values</option>';
  if (!col || !S.profile) return;
  const colDef = S.profile.columns.find(c => c.name === col);
  if (colDef?.sample_values?.length) {
    colDef.sample_values.forEach(v => {
      const opt = document.createElement('option'); opt.value = v; opt.textContent = v; valSel.appendChild(opt);
    });
  }
}
function applyFilter() {
  const col = document.getElementById('filter-col').value;
  const val = document.getElementById('filter-val').value;
  S.filter = { col: col || null, val: val || null };
  showToast(val ? `Filtered: ${col} = "${val}"` : 'Filter cleared', 'info');
}
function clearFilter() {
  document.getElementById('filter-col').value = '';
  document.getElementById('filter-val').value = '';
  S.filter = { col: null, val: null };
  showToast('Filter cleared', 'info');
}

// ── Toast notifications ───────────────────────────────────────
function showToast(msg, type='info', duration=3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = {success:'✓', error:'✕', info:'ℹ', warn:'⚠'};
  toast.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ'}</span><span class="toast-msg">${msg}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, duration);
}

// ── Chart card builder (with ⋮ menu) ─────────────────────────
function makeChartCard(chart, idx, height) {
  const card = el("div","chart-card");
  const is3D  = ["scatter3d","surface3d","3d_scatter","3d_surface"].includes(chart.type);
  const isAnim = ["animated_bar","animated_scatter"].includes(chart.type);
  const badges = [`<span class="chart-type-tag">${chart.type||"chart"}</span>`];
  if (is3D)   badges.push('<span class="chart-type-tag tag-3d">3D Interactive</span>');
  if (isAnim) badges.push('<span class="chart-type-tag tag-anim">▶ Animated</span>');

  card.innerHTML = `
    <div class="chart-hd">
      <div class="chart-hd-left">
        <span class="chart-title">${chart.title||""}</span>
        ${badges.join("")}
      </div>
      <div class="chart-menu-wrap">
        <button class="chart-menu-btn" onclick="toggleChartMenu(event,${idx})">⋮</button>
        <div class="chart-menu" id="cmenu-${idx}">
          <button onclick="openEditPanel(${idx})">✎ Edit</button>
          <button onclick="openFullscreen(${idx})">⛶ Fullscreen</button>
          <button onclick="downloadChartPNG(${idx},'${(chart.title||'chart').replace(/'/g,"\\'")}')">↓ PNG</button>
          <button onclick="duplicateChart(${idx})">⧉ Duplicate</button>
          <button onclick="deleteChart(${idx})">✕ Remove</button>
        </div>
      </div>
    </div>
    ${chart.subtitle ? `<div class="chart-sub">${chart.subtitle}</div>` : ""}
    <div id="plt-${idx}" style="width:100%;height:${height}"></div>`;
  return card;
}

// ── Chart menu ────────────────────────────────────────────────
function toggleChartMenu(e, idx) {
  e.stopPropagation();
  document.querySelectorAll('.chart-menu.open').forEach(m => { if (m.id !== `cmenu-${idx}`) m.classList.remove('open'); });
  document.getElementById(`cmenu-${idx}`)?.classList.toggle('open');
}

// ── Edit panel ────────────────────────────────────────────────
function openEditPanel(idx) {
  // Normalize idx: strip "100+" prefix used in charts tab
  const chartIdx = idx >= 100 ? idx - 100 : idx;
  const chart = S.dash?.charts?.[chartIdx];
  if (!chart) return;
  S.editIdx = chartIdx;
  document.querySelectorAll('.chart-menu.open').forEach(m => m.classList.remove('open'));

  // Populate column selects
  const cols = S.profile?.columns || [];
  ['ep-x','ep-y','ep-color'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">— none —</option>';
    cols.forEach(c => { const o = document.createElement('option'); o.value = c.name; o.textContent = c.name; sel.appendChild(o); });
  });

  // Fill current values from spec
  const spec = chart.spec || {};
  document.getElementById('ep-type').value  = spec.type  || chart.type || 'bar';
  document.getElementById('ep-x').value     = spec.x     || '';
  document.getElementById('ep-y').value     = spec.y     || '';
  document.getElementById('ep-color').value = spec.color || '';
  document.getElementById('ep-agg').value   = spec.agg   || 'sum';
  document.getElementById('ep-title').value = spec.title || chart.title || '';

  document.getElementById('edit-panel').classList.add('open');
  document.getElementById('edit-overlay').classList.add('show');
}

function closeEditPanel() {
  document.getElementById('edit-panel')?.classList.remove('open');
  document.getElementById('edit-overlay')?.classList.remove('show');
  S.editIdx = null;
}

async function applyChartEdit() {
  if (S.editIdx == null || !S.dash) return;
  const btn = document.getElementById('ep-apply-btn');
  btn.disabled = true; btn.textContent = 'Applying…';

  const spec = {
    type:  document.getElementById('ep-type').value,
    x:     document.getElementById('ep-x').value     || null,
    y:     document.getElementById('ep-y').value     || null,
    color: document.getElementById('ep-color').value || null,
    agg:   document.getElementById('ep-agg').value,
    title: document.getElementById('ep-title').value,
    id:    S.dash.charts[S.editIdx]?.id || `c${S.editIdx}`,
    span:  S.dash.charts[S.editIdx]?.span || 1,
  };

  try {
    const r = await fetch(`${API}/api/chart/update`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ did: S.did, spec }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.detail || 'Update failed'); }
    const data = await r.json();

    // Update chart in state
    S.dash.charts[S.editIdx] = Object.assign({}, S.dash.charts[S.editIdx], {
      type: data.type, figure: data.figure, spec: data.spec,
      title: spec.title || S.dash.charts[S.editIdx].title,
    });

    // Re-render both tabs
    renderOverview(S.dash);
    renderChartsTab(S.dash);
    closeEditPanel();
    showToast('Chart updated!', 'success');
  } catch (e) {
    showToast('Update failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Apply';
  }
}

// ── Fullscreen ────────────────────────────────────────────────
function openFullscreen(idx) {
  const chartIdx = idx >= 100 ? idx - 100 : idx;
  const chart = S.dash?.charts?.[chartIdx];
  if (!chart?.figure) return;
  document.querySelectorAll('.chart-menu.open').forEach(m => m.classList.remove('open'));

  const modal = document.getElementById('fullscreen-modal');
  document.getElementById('fs-title').textContent = chart.title || '';
  modal.classList.add('open');

  const div = document.getElementById('fs-chart');
  div.innerHTML = '';
  setTimeout(() => plotOne(div, chart), 50);
}
function closeFullscreen() {
  document.getElementById('fullscreen-modal')?.classList.remove('open');
  const div = document.getElementById('fs-chart');
  if (div) { try { Plotly.purge(div); } catch {} div.innerHTML = ''; }
}

// ── PNG download ──────────────────────────────────────────────
function downloadChartPNG(idx, title) {
  const chartIdx = idx >= 100 ? idx - 100 : idx;
  const div = document.getElementById('plt-' + idx);
  if (!div) return;
  document.querySelectorAll('.chart-menu.open').forEach(m => m.classList.remove('open'));
  try {
    Plotly.downloadImage(div, { format:'png', scale:2, filename: (title||'chart').replace(/\W+/g,'_'), width:1200, height:600 });
    showToast('Downloading PNG…', 'info');
  } catch (e) { showToast('PNG download failed', 'error'); }
}

function duplicateChart(idx) {
  const chartIdx = idx >= 100 ? idx - 100 : idx;
  if (!S.dash?.charts?.[chartIdx]) return;
  document.querySelectorAll('.chart-menu.open').forEach(m => m.classList.remove('open'));
  const copy = JSON.parse(JSON.stringify(S.dash.charts[chartIdx]));
  copy.id = copy.id + '_copy'; copy.title = (copy.title || 'Chart') + ' (copy)';
  S.dash.charts.push(copy);
  renderOverview(S.dash); renderChartsTab(S.dash);
  showToast('Chart duplicated', 'info');
}

function deleteChart(idx) {
  const chartIdx = idx >= 100 ? idx - 100 : idx;
  if (!S.dash?.charts?.[chartIdx]) return;
  document.querySelectorAll('.chart-menu.open').forEach(m => m.classList.remove('open'));
  S.dash.charts.splice(chartIdx, 1);
  renderOverview(S.dash); renderChartsTab(S.dash);
  showToast('Chart removed', 'info');
}

// ── Chat ──────────────────────────────────────────────────────
function toggleChat() {
  const panel = document.getElementById('chat-panel');
  if (!panel) return;
  CHAT.open = !CHAT.open;
  panel.classList.toggle('open', CHAT.open);
  if (CHAT.open) document.getElementById('cp-input')?.focus();
}

function renderChatSuggestions() {
  const cols = S.profile?.columns || [];
  const numCols = cols.filter(c => c.semantic === 'numeric').slice(0,2);
  const catCols = cols.filter(c => c.semantic === 'categorical').slice(0,1);
  const suggestions = [];
  if (numCols[0]) suggestions.push(`What's the average ${numCols[0].name}?`);
  if (catCols[0] && numCols[0]) suggestions.push(`Show ${numCols[0].name} by ${catCols[0].name}`);
  suggestions.push('What are the key insights from this data?');
  const wrap = document.getElementById('cp-suggestions');
  if (!wrap) return;
  wrap.innerHTML = suggestions.map(s =>
    `<button class="cp-suggestion" onclick="useSuggestion('${s.replace(/'/g,"\\'")}')"> ${s}</button>`
  ).join('');
}

function useSuggestion(text) {
  const inp = document.getElementById('cp-input');
  if (inp) inp.value = text;
  const wrap = document.getElementById('cp-suggestions');
  if (wrap) wrap.innerHTML = '';
}

async function sendChat() {
  const input = document.getElementById('cp-input');
  const msg = (input?.value || "").trim();
  if (!msg || !S.did) return;
  input.value = '';
  document.getElementById('cp-suggestions').innerHTML = '';

  appendChatMsg('user', msg);
  const thinkId = 'think-' + (++CHAT.counter);
  appendChatMsg('assistant', 'Thinking…', thinkId, true);

  CHAT.history.push({ role: 'user', content: msg });

  try {
    const r = await fetch(`${API}/api/chat`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        did: S.did, message: msg,
        current_charts: (S.dash?.charts || []).map(ch => ({ id: ch.id, type: ch.type, title: ch.title, spec: ch.spec })),
        history: CHAT.history.slice(-6),
      }),
      signal: AbortSignal.timeout(30000),
    });
    removeChatMsg(thinkId);
    if (!r.ok) throw new Error('Chat failed');
    const data = await r.json();
    appendChatMsg('assistant', data.reply);
    CHAT.history.push({ role: 'assistant', content: data.reply });

    // Process actions
    if (data.actions?.length) {
      for (const action of data.actions) {
        await processChatAction(action);
      }
    }
  } catch (e) {
    removeChatMsg(thinkId);
    appendChatMsg('assistant', 'Sorry, something went wrong. Please try again.');
  }
}

async function processChatAction(action) {
  if (!S.did || !S.dash) return;
  if (action.type === 'update_chart') {
    const chartId = action.chart_id;
    const chartIdx = S.dash.charts.findIndex(c => c.id === chartId);
    if (chartIdx < 0) { showToast(`Chart "${chartId}" not found`, 'warn'); return; }
    try {
      const spec = Object.assign({}, S.dash.charts[chartIdx].spec || {}, action.spec || {});
      const r = await fetch(`${API}/api/chart/update`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ did: S.did, spec }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error('Update failed');
      const data = await r.json();
      S.dash.charts[chartIdx] = Object.assign({}, S.dash.charts[chartIdx], {
        type: data.type, figure: data.figure, spec: data.spec,
        title: spec.title || S.dash.charts[chartIdx].title,
      });
      renderOverview(S.dash); renderChartsTab(S.dash);
      showToast('Chart updated by AI!', 'success');
    } catch (e) { showToast('AI chart update failed', 'error'); }
  } else if (action.type === 'add_chart') {
    const spec = action.spec || {};
    try {
      const r = await fetch(`${API}/api/chart/update`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ did: S.did, spec: Object.assign({ id: `ai-${Date.now()}`, span: spec.span || 1 }, spec) }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error('Add failed');
      const data = await r.json();
      S.dash.charts.push({
        id: spec.id || `ai-${Date.now()}`, type: data.type,
        title: spec.title || 'AI Chart', subtitle: null,
        span: spec.span || 1, figure: data.figure, spec: data.spec,
      });
      renderOverview(S.dash); renderChartsTab(S.dash);
      showToast('Chart added by AI!', 'success');
    } catch (e) { showToast('AI chart add failed', 'error'); }
  }
}

function appendChatMsg(role, text, id, isThinking=false) {
  const msgs = document.getElementById('cp-messages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = `cp-msg ${role}`;
  if (id) div.id = id;
  const bubble = document.createElement('div');
  bubble.className = `cp-bubble${isThinking ? ' thinking' : ''}`;
  bubble.textContent = text;
  div.appendChild(bubble);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeChatMsg(id) {
  document.getElementById(id)?.remove();
}

// ── Export CSV ────────────────────────────────────────────────
function exportCSV() {
  if (!S.profile?.preview?.length) return;
  const rows = S.profile.preview;
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c]??'')).join(','))].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = (S.file || 'data').replace(/\.[^.]+$/, '') + '_preview.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('CSV exported', 'success');
}

// ── plotAll / plotOne ─────────────────────────────────────────
function plotAll(charts) {
  charts.forEach((ch, i) => {
    const div = document.getElementById("plt-" + i);
    if (!div || !ch.figure) return;
    plotOne(div, ch);
  });
}

function plotOne(div, ch) {
  try {
    const layout = Object.assign({}, ch.figure.layout || {}, {
      autosize: true,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor:  "rgba(0,0,0,0)",
    });
    const is3D = (ch.figure.data || []).some(t => ["scatter3d","surface","mesh3d"].includes(t.type));
    if (is3D) {
      const sa = { backgroundcolor:"rgba(6,10,20,0.95)", gridcolor:"rgba(255,255,255,0.06)", color:"#607090", showbackground:true };
      layout.scene = Object.assign({}, layout.scene || {}, { bgcolor:"rgba(6,10,20,0.95)", xaxis:sa, yaxis:sa, zaxis:sa });
      div.style.height = "480px";
    }
    const isAnimated = !!(ch.figure.frames && ch.figure.frames.length);
    if (isAnimated) {
      if (layout.sliders) {
        layout.sliders = layout.sliders.map(s => Object.assign({}, s, {
          font:{color:"#607090",size:10}, currentvalue:Object.assign({},s.currentvalue,{font:{color:"#c8d4e8",size:12}}),
          bgcolor:"#111b2e", bordercolor:"#1b2a44", activebgcolor:"#1b2a44",
        }));
      }
      if (layout.updatemenus) {
        layout.updatemenus = layout.updatemenus.map(u => Object.assign({}, u, { bgcolor:"#111b2e", bordercolor:"#1b2a44", font:{color:"#c8d4e8",size:11} }));
      }
      layout.margin = Object.assign({}, layout.margin, { b: 80 });
      div.style.height = "480px";
    }
    const config = {
      responsive:true, displayModeBar:true, displaylogo:false,
      modeBarButtonsToRemove:["sendDataToCloud","lasso2d","select2d","autoScale2d"],
      toImageButtonOptions:{ format:"png", scale:2, filename:ch.title||"chart" },
    };
    if (isAnimated && ch.figure.frames) {
      Plotly.newPlot(div, ch.figure.data||[], layout, config).then(() => Plotly.addFrames(div, ch.figure.frames));
    } else {
      Plotly.newPlot(div, ch.figure.data||[], layout, config);
    }
  } catch (e) {
    console.error("Plotly error:", e);
    div.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:24px;text-align:center">Chart could not be rendered</div>';
  }
}

function mkFooter(d) {
  const f = el("div","dash-footer");
  f.textContent = `DashAI · ${new Date().toLocaleDateString()} · ${(d.charts||[]).length} charts`;
  return f;
}

function fmtKPI(n, fmt) {
  try {
    const v = parseFloat(n);
    if (isNaN(v)) return String(n);
    if (fmt === "currency") {
      if (Math.abs(v) >= 1e9) return `$${(v/1e9).toFixed(2)}B`;
      if (Math.abs(v) >= 1e6) return `$${(v/1e6).toFixed(2)}M`;
      if (Math.abs(v) >= 1e3) return `$${(v/1e3).toFixed(1)}K`;
      return `$${v.toFixed(0)}`;
    }
    if (fmt === "percent") return `${v.toFixed(1)}%`;
    if (Math.abs(v) >= 1e6) return `${(v/1e6).toFixed(2)}M`;
    if (Math.abs(v) >= 1e3) return `${(v/1e3).toFixed(1)}K`;
    return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  } catch { return String(n); }
}

// ── Export HTML ───────────────────────────────────────────────
async function doExportHTML() {
  if (!S.dash) return;
  const btn = document.getElementById("btn-export-html");
  const orig = btn.innerHTML;
  btn.innerHTML = '<span>⏳ Exporting…</span>'; btn.style.pointerEvents = "none";
  try {
    const r = await fetch(`${API}/api/export/html`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ dashboard: S.dash }), signal:AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error("Export failed");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = (S.dash.title||"dashboard").replace(/\W+/g,"_") + ".html"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('HTML exported!', 'success');
  } catch (e) { showToast("Export failed: " + e.message, 'error'); }
  finally { btn.innerHTML = orig; btn.style.pointerEvents = ""; }
}

// ── Export PNG ────────────────────────────────────────────────
function doExportPNG() {
  const charts = S.dash?.charts || [];
  if (!charts.length) { showToast("Generate a dashboard first.", "warn"); return; }
  const base = (S.dash?.title || "chart").replace(/\W+/g, "_");
  charts.forEach((c, i) => {
    const div = document.getElementById("plt-" + i);
    if (!div) return;
    setTimeout(() => {
      try { Plotly.downloadImage(div, { format:"png", scale:2, filename:`${base}_${i+1}`, width:i===0?1400:900, height:i===0?660:480 }); } catch {}
    }, i * 800);
  });
  showToast('Downloading PNGs…', 'info');
}

// ── UI helpers ────────────────────────────────────────────────
function showFileInfo(data) {
  document.getElementById("fi-name").textContent = data.filename;
  document.getElementById("fi-rows").textContent = data.rows.toLocaleString() + " rows";
  document.getElementById("fi-cols").textContent = (data.usable_cols||data.cols) + " columns";
  document.getElementById("file-info").classList.add("show");
}
function renderChips(columns) {
  const w = document.getElementById("col-chips"); w.innerHTML = "";
  (columns||[]).forEach(c => {
    const tp = c.semantic==="numeric"?"n":c.semantic==="datetime"?"d":"c";
    const lbl = tp==="n"?"#":tp==="d"?"DT":"T";
    const d = document.createElement("div"); d.className = "col-chip";
    d.innerHTML = `<span class="ct ct-${tp}">${lbl}</span>${c.name}`; w.appendChild(d);
  });
  w.classList.add("show");
}
function setSt(msg) { const r=document.getElementById("st-row"); r.classList.add("show"); document.getElementById("st-msg").textContent=msg; }
function clearSt() { document.getElementById("st-row").classList.remove("show"); }
function showErr(msg) { clearSt(); const e=document.getElementById("err-row"); e.textContent="⚠ "+msg; e.classList.add("show"); }
function clearErr() { document.getElementById("err-row").classList.remove("show"); }
function el(tag, cls) { const e = document.createElement(tag); if(cls) e.className=cls; return e; }
function goBack() {
  document.getElementById("page-dash").classList.remove("show");
  document.getElementById("page-upload").style.display = "flex";
  document.body.classList.remove('dash-active');
  S.filter = { col: null, val: null };
  if (document.getElementById('chat-panel')?.classList.contains('open')) toggleChat();
}
