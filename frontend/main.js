"use strict";

const API = window.DASHAI_API || "http://localhost:7860";

// ── State ─────────────────────────────────────────────────────
const S = {
  datasetId:  null,
  dashboard:  null,
  fileName:   "",
  genTimer:   null,
  progTimer:  null,
};

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  document.getElementById("file-input").addEventListener("change", e => {
    if (e.target.files[0]) handleUpload(e.target.files[0]);
  });
});

// ── Health ────────────────────────────────────────────────────
async function checkHealth() {
  const dot = document.querySelector(".ai-dot");
  const txt = document.querySelector(".ai-txt");
  try {
    const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(7000) });
    if (r.ok) {
      const d = await r.json();
      const active = Object.entries(d.providers || {}).filter(([,v]) => v);
      dot.classList.add(active.length ? "online" : "warn");
      txt.textContent = active.length ? "AI ready" : "No API keys configured";
    } else {
      dot.classList.add("warn");
      txt.textContent = "Backend error";
    }
  } catch {
    txt.textContent = "Offline";
  }
}

// ── Drag & drop ───────────────────────────────────────────────
const dz = document.getElementById("dropzone");
dz.addEventListener("dragover",  e => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop",      e => { e.preventDefault(); dz.classList.remove("over"); if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]); });
dz.addEventListener("click",     () => document.getElementById("file-input").click());

// ── Upload ────────────────────────────────────────────────────
async function handleUpload(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["csv","xlsx","xls"].includes(ext)) { showErr("Please use CSV or Excel (.xlsx) files."); return; }
  clearErr(); S.datasetId = null; S.fileName = file.name;
  setSt("Uploading & profiling columns…");

  try {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${API}/api/upload`, {
      method: "POST", body: fd, signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({ detail: "Upload failed" }));
      throw new Error(e.detail || "Upload failed");
    }
    const data = await r.json();
    S.datasetId = data.id;
    showFileInfo(data);
    renderColChips(data.columns);
    clearSt();
    document.getElementById("gen-btn").disabled = false;
    // Auto-generate immediately
    doGenerate();
  } catch(e) {
    clearSt(); showErr(e.message);
  }
}

// ── Sample ────────────────────────────────────────────────────
async function loadSample(name) {
  clearErr(); setSt("Loading sample dataset…");
  try {
    const r = await fetch(`${API}/api/sample/${name}`, { method: "POST" });
    if (!r.ok) throw new Error("Could not load sample");
    const data = await r.json();
    S.datasetId = data.id; S.fileName = data.filename;
    showFileInfo(data); renderColChips(data.columns); clearSt();
    document.getElementById("gen-btn").disabled = false;
    doGenerate();
  } catch(e) { clearSt(); showErr(e.message); }
}

// ── Generate ──────────────────────────────────────────────────
async function doGenerate() {
  if (!S.datasetId) return;
  clearErr();
  showGenOverlay();

  try {
    const r = await fetch(`${API}/api/generate/${S.datasetId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) throw new Error("Generation failed: " + r.status);
    S.dashboard = await r.json();
  } catch(e) {
    hideGenOverlay();
    showErr("Could not generate dashboard: " + e.message);
    return;
  }

  hideGenOverlay();
  document.getElementById("page-upload").style.display = "none";
  document.getElementById("page-dashboard").classList.add("show");
  document.getElementById("tb-title").textContent = S.fileName;
  renderDashboard(S.dashboard);
}

// ── Overlay ───────────────────────────────────────────────────
function showGenOverlay() {
  const ov = document.getElementById("gen-overlay");
  ov.classList.add("show");
  const steps = [
    "Analyzing columns…",
    "AI selecting charts…",
    "Building visualizations…",
    "Applying theme…",
    "Almost there…",
  ];
  let si = 0, pct = 0;
  const label = document.getElementById("gen-label");
  const bar   = document.getElementById("gen-bar");
  label.textContent = steps[0];
  bar.style.width = "5%";
  S.genTimer = setInterval(() => {
    si  = (si + 1) % steps.length;
    pct = Math.min(90, pct + 18 + Math.random() * 8);
    label.textContent = steps[si];
    bar.style.width   = pct + "%";
  }, 1600);
}

function hideGenOverlay() {
  clearInterval(S.genTimer);
  const bar = document.getElementById("gen-bar");
  bar.style.width = "100%";
  setTimeout(() => {
    document.getElementById("gen-overlay").classList.remove("show");
    bar.style.width = "0%";
  }, 350);
}

// ── Render dashboard ──────────────────────────────────────────
function renderDashboard(d) {
  const canvas = document.getElementById("dash-canvas");
  canvas.innerHTML = "";

  // Header
  const hdr = el("div", "dash-hdr fade-up");
  hdr.innerHTML = `<div class="dash-hdr-title">${d.title || "Dashboard"}</div>
    <div class="dash-hdr-sub">${d.subtitle || ""}</div>`;
  canvas.appendChild(hdr);

  // KPI grid
  if (d.kpis && d.kpis.length) {
    const colors = ["#22d3ee","#a78bfa","#10b981","#f59e0b","#5b6ef5","#f87171"];
    const icons  = ["💰","📈","🎯","📦","⚡","🔢"];
    const grid   = el("div", "kpi-grid fade-up d1");
    d.kpis.forEach((k, i) => {
      const card = el("div", "kpi-card");
      const color = colors[i % colors.length];
      card.style.setProperty("--kc", color);
      const val = k.formatted_value || fmtKPI(k.value, k.format);
      const sub = (k.column ? `${k.metric} of ${k.column}` : "total records");
      card.innerHTML = `
        <div class="kpi-top">
          <div class="kpi-lbl">${k.label}</div>
          <div class="kpi-ico">${icons[i % icons.length]}</div>
        </div>
        <div class="kpi-val">${val}</div>
        <div class="kpi-sub">${sub}</div>`;
      grid.appendChild(card);
    });
    canvas.appendChild(grid);
  }

  // Charts
  const charts = d.charts || [];
  const hero   = charts.find(c => c.span >= 2) || charts[0];
  const subs   = charts.filter(c => c !== hero);

  if (hero) {
    const sec = el("div", "hero-section fade-up d2");
    sec.appendChild(makeChartCard(hero, "hero"));
    canvas.appendChild(sec);
  }
  if (subs.length) {
    const grid = el("div", "sub-grid fade-up d3");
    subs.forEach(c => grid.appendChild(makeChartCard(c, "sub")));
    canvas.appendChild(grid);
  }

  // Footer
  const foot = el("div", "dash-footer");
  foot.textContent = `DashAI · ${new Date().toLocaleDateString()} · ${d.charts?.length || 0} charts`;
  canvas.appendChild(foot);

  // ─── Render Plotly figures ────────────────────────────────
  // Wait for Plotly to be ready AND DOM to settle, then render
  const renderAll = () => {
    charts.forEach((c, i) => {
      const div = document.getElementById("plt-" + i);
      if (!div || !c.figure) return;
      try {
        // Merge stored layout with our dark theme overrides
        const layout = Object.assign({}, c.figure.layout || {}, {
          autosize: true,
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor:  "rgba(0,0,0,0)",
        });
        Plotly.newPlot(
          div,
          c.figure.data || [],
          layout,
          {
            responsive: true,
            displayModeBar: true,
            displaylogo: false,
            modeBarButtonsToRemove: ["sendDataToCloud","lasso2d","select2d","autoScale2d"],
            toImageButtonOptions: { format:"png", scale:2, filename: c.title || "chart" },
          }
        );
      } catch(e) {
        console.error("Plotly render error:", e, c);
        div.innerHTML = `<div style="color:#607090;font-size:12px;padding:20px;text-align:center">Could not render this chart</div>`;
      }
    });
  };

  // Double RAF ensures the browser has painted the containers
  requestAnimationFrame(() => requestAnimationFrame(() => {
    setTimeout(renderAll, 80);
  }));
}

// ── Chart card DOM ────────────────────────────────────────────
let _chartIdx = 0;
function makeChartCard(chart, type) {
  const idx = (S.dashboard?.charts || []).indexOf(chart);
  const card = el("div", "chart-card");
  card.innerHTML = `
    <div class="chart-hd"><span class="chart-title">${chart.title || ""}</span></div>
    ${chart.subtitle ? `<div class="chart-sub">${chart.subtitle}</div>` : ""}
    <div id="plt-${idx}" style="width:100%;height:${type==="hero"?"410px":"300px"}"></div>`;
  return card;
}

// ── Formatting ────────────────────────────────────────────────
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
  if (!S.dashboard) return;
  const btn = document.getElementById("export-html-btn");
  const orig = btn.innerHTML;
  btn.innerHTML = "⏳ Exporting…";
  btn.disabled = true;

  try {
    const r = await fetch(`${API}/api/export/html`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dashboard: S.dashboard }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error("Export failed: " + r.status);
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const title = (S.dashboard.title || "dashboard").replace(/\W+/g, "_");
    a.href = url; a.download = title + ".html"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch(e) {
    console.error("HTML export error:", e);
    alert("Export failed: " + e.message);
  } finally {
    btn.innerHTML = orig;
    btn.disabled  = false;
  }
}

// ── Export PNG ────────────────────────────────────────────────
function doExportPNG() {
  const charts = S.dashboard?.charts || [];
  if (!charts.length) { alert("Generate a dashboard first."); return; }
  const base = (S.dashboard?.title || "chart").replace(/\W+/g, "_");
  charts.forEach((c, i) => {
    const div = document.getElementById("plt-" + i);
    if (!div) return;
    setTimeout(() => {
      try {
        Plotly.downloadImage(div, {
          format: "png", scale: 2,
          filename: `${base}_chart_${i+1}`,
          width:  i === 0 ? 1400 : 900,
          height: i === 0 ? 660  : 480,
        });
      } catch(e) { console.warn("PNG export:", e); }
    }, i * 800);
  });
}

// ── UI helpers ────────────────────────────────────────────────
function showFileInfo(data) {
  const fr = document.getElementById("file-row");
  document.getElementById("file-nm").textContent   = data.filename;
  document.getElementById("ft-rows").textContent   = data.rows.toLocaleString() + " rows";
  document.getElementById("ft-cols").textContent   = (data.usable_cols || data.cols) + " columns";
  fr.classList.add("show");
}

function renderColChips(columns) {
  const wrap = document.getElementById("col-chips");
  wrap.innerHTML = "";
  (columns || []).forEach(c => {
    const tp  = c.semantic === "numeric" ? "n" : c.semantic === "datetime" ? "d" : "c";
    const lbl = c.semantic === "numeric" ? "#" : c.semantic === "datetime" ? "DT" : "T";
    const d   = document.createElement("div");
    d.className = "col-chip";
    d.innerHTML = `<span class="ct ct-${tp}">${lbl}</span>${c.name}`;
    wrap.appendChild(d);
  });
  wrap.classList.add("show");
}

function setSt(msg)   { const b = document.getElementById("st-bar"); b.classList.add("show"); document.getElementById("st-txt").textContent = msg; }
function clearSt()    { document.getElementById("st-bar").classList.remove("show"); }
function showErr(msg) { clearSt(); const e = document.getElementById("err-bar"); e.textContent = "⚠ " + msg; e.classList.add("show"); }
function clearErr()   { document.getElementById("err-bar").classList.remove("show"); }
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }

function goBack() {
  document.getElementById("page-dashboard").classList.remove("show");
  document.getElementById("page-upload").style.display = "flex";
}
