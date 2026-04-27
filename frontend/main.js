"use strict";
const API = window.DASHAI_API || "http://localhost:7860";
const S = { did:null, dash:null, file:"", profile:null, genTimer:null };

// ── Boot ──
document.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  const fi = document.getElementById("file-input");
  fi.addEventListener("change", e => e.target.files[0] && handleUpload(e.target.files[0]));
  const da = document.getElementById("drop-area");
  da.addEventListener("dragover", e => { e.preventDefault(); da.classList.add("over"); });
  da.addEventListener("dragleave", () => da.classList.remove("over"));
  da.addEventListener("drop", e => { e.preventDefault(); da.classList.remove("over"); e.dataTransfer.files[0] && handleUpload(e.dataTransfer.files[0]); });
  updateClock();
  setInterval(updateClock, 30000);
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
  } catch { txt.textContent = "Offline"; }
}

// ── Upload ──
async function handleUpload(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["csv","xlsx","xls"].includes(ext)) { showErr("Upload CSV or Excel files only."); return; }
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

// ── Generate ──
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
  } catch (e) { hideOverlay(); showErr(e.message); return; }
  hideOverlay();
  document.getElementById("page-upload").style.display = "none";
  document.getElementById("page-dash").classList.add("show");
  document.getElementById("tb-filename").textContent = S.file;
  document.getElementById("sb-filename").textContent = S.file;
  renderOverview(S.dash);
  renderChartsTab(S.dash);
  renderDataTab();
  switchTab("overview", document.querySelector('[data-tab="overview"]'));
}

// ── Overlay ──
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

// ── Sidebar ──
function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("collapsed");
  // Reflow Plotly charts
  setTimeout(() => {
    document.querySelectorAll("[id^='plt-']").forEach(div => {
      try { Plotly.Plots.resize(div); } catch {}
    });
  }, 300);
}

// ── Tabs ──
function switchTab(tab, btn) {
  document.querySelectorAll(".sb-item").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
  // Re-render charts on tab show
  if (tab === "overview" || tab === "charts") {
    setTimeout(() => {
      document.querySelectorAll("[id^='plt-']").forEach(div => {
        try { Plotly.Plots.resize(div); } catch {}
      });
    }, 100);
  }
}

// ── Render: Overview tab ──
function renderOverview(d) {
  const c = document.getElementById("overview-canvas"); c.innerHTML = "";

  // Header
  const hdr = el("div","dash-hdr fade-up");
  hdr.innerHTML = `<div class="dash-title">${d.title||"Dashboard"}</div><div class="dash-sub">${d.subtitle||""}</div>`;
  c.appendChild(hdr);

  // KPIs
  if (d.kpis?.length) {
    const g = el("div","kpi-grid");
    const colors = ["#00d4e8","#9b7aff","#00c48c","#ffb020","#4f6df5","#ff5c6a"];
    const icons  = ["💰","📈","🎯","📦","⚡","🔢"];
    d.kpis.forEach((k, i) => {
      const card = el("div","kpi-card");
      card.style.setProperty("--kc", colors[i%colors.length]);
      const val = k.formatted_value || fmtKPI(k.value, k.format);
      // Generate a fake trend for demo purposes
      const trendVal = (Math.random() * 30 - 10).toFixed(1);
      const trendCls = trendVal > 0 ? "up" : trendVal < 0 ? "down" : "neutral";
      const trendArrow = trendVal > 0 ? "↑" : trendVal < 0 ? "↓" : "→";
      card.innerHTML = `
        <div class="kpi-hd">
          <div class="kpi-lbl">${k.label}</div>
          <div class="kpi-ico">${icons[i%icons.length]}</div>
        </div>
        <div class="kpi-val">${val}</div>
        <div class="kpi-sub">${k.column ? k.metric + " of " + k.column : "total records"}</div>
        <div class="kpi-trend ${trendCls}">${trendArrow} ${Math.abs(trendVal)}%</div>`;
      g.appendChild(card);
    });
    c.appendChild(g);
  }

  // Charts: hero + grid
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

// ── Render: Charts tab (all charts full-width stacked) ──
function renderChartsTab(d) {
  const c = document.getElementById("charts-canvas"); c.innerHTML = "";
  const hdr = el("div","dash-hdr");
  hdr.innerHTML = `<div class="dash-title">All Charts</div><div class="dash-sub">${(d.charts||[]).length} visualizations generated</div>`;
  c.appendChild(hdr);
  const wrap = el("div","charts-full-grid");
  (d.charts||[]).forEach((ch, i) => {
    wrap.appendChild(makeChartCard(ch, 100+i, "440px"));
  });
  c.appendChild(wrap);
  setTimeout(() => {
    (d.charts||[]).forEach((ch, i) => {
      const div = document.getElementById("plt-" + (100+i));
      if (!div || !ch.figure) return;
      plotOne(div, ch);
    });
  }, 200);
}

// ── Render: Data tab ──
function renderDataTab() {
  const c = document.getElementById("data-canvas"); c.innerHTML = "";
  const preview = S.profile?.preview;
  if (!preview || !preview.length) {
    c.innerHTML = '<div style="padding:40px;color:var(--muted);text-align:center">No data preview available</div>';
    return;
  }
  const hdr = el("div","dash-hdr");
  hdr.innerHTML = `<div class="dash-title">Data Preview</div><div class="dash-sub">First ${preview.length} rows of ${S.file}</div>`;
  c.appendChild(hdr);

  const cols = Object.keys(preview[0]);
  const wrap = el("div","data-table-wrap");
  let html = '<table class="data-table"><thead><tr>';
  cols.forEach(col => { html += `<th>${col}</th>`; });
  html += '</tr></thead><tbody>';
  preview.forEach(row => {
    html += '<tr>';
    cols.forEach(col => {
      let val = String(row[col] ?? "");
      if (val.length > 50) val = val.slice(0, 47) + "…";
      html += `<td title="${String(row[col]||"").replace(/"/g,"&quot;")}">${val}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
  c.appendChild(wrap);

  const info = el("div","data-rows-info");
  info.textContent = `Showing ${preview.length} rows · ${cols.length} columns`;
  c.appendChild(info);
}

// ── Chart card builder ──
function makeChartCard(chart, idx, height) {
  const card = el("div","chart-card");
  const is3D = ["scatter3d","surface3d","3d_scatter","3d_surface","scatter_3d","surface_3d"].includes(chart.type);
  const isAnim = ["animated_bar","animated_scatter"].includes(chart.type);
  const badges = [];
  badges.push(`<span class="chart-type-tag">${chart.type||"chart"}</span>`);
  if (is3D)   badges.push('<span class="chart-type-tag tag-3d">3D Interactive</span>');
  if (isAnim) badges.push('<span class="chart-type-tag tag-anim">▶ Animated</span>');

  card.innerHTML = `
    <div class="chart-hd">
      <div class="chart-hd-left">
        <span class="chart-title">${chart.title||""}</span>
        ${badges.join("")}
      </div>
    </div>
    ${chart.subtitle ? `<div class="chart-sub">${chart.subtitle}</div>` : ""}
    <div id="plt-${idx}" style="width:100%;height:${height}"></div>`;
  return card;
}

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
      plot_bgcolor: "rgba(0,0,0,0)",
    });

    // 3D charts: style scene backgrounds for dark theme
    const is3D = (ch.figure.data || []).some(t =>
      ["scatter3d","surface","mesh3d"].includes(t.type)
    );
    if (is3D) {
      const sceneAxis = {
        backgroundcolor: "rgba(6,10,20,0.95)",
        gridcolor: "rgba(255,255,255,0.06)",
        color: "#607090",
        showbackground: true,
      };
      layout.scene = Object.assign({}, layout.scene || {}, {
        bgcolor: "rgba(6,10,20,0.95)",
        xaxis: Object.assign({}, layout.scene?.xaxis, sceneAxis),
        yaxis: Object.assign({}, layout.scene?.yaxis, sceneAxis),
        zaxis: Object.assign({}, layout.scene?.zaxis, sceneAxis),
      });
      // Give 3D charts more height
      div.style.height = "480px";
    }

    // Animated charts: style slider and buttons for dark theme
    const isAnimated = !!(ch.figure.frames && ch.figure.frames.length);
    if (isAnimated) {
      // Ensure slider text is visible
      if (layout.sliders) {
        layout.sliders = layout.sliders.map(s => Object.assign({}, s, {
          font: { color: "#607090", size: 10 },
          currentvalue: Object.assign({}, s.currentvalue, { font: { color: "#c8d4e8", size: 12 } }),
          bgcolor: "#111b2e",
          bordercolor: "#1b2a44",
          activebgcolor: "#1b2a44",
        }));
      }
      if (layout.updatemenus) {
        layout.updatemenus = layout.updatemenus.map(u => Object.assign({}, u, {
          bgcolor: "#111b2e",
          bordercolor: "#1b2a44",
          font: { color: "#c8d4e8", size: 11 },
        }));
      }
      // Give animated charts more bottom margin for controls
      layout.margin = Object.assign({}, layout.margin, { b: 80 });
      div.style.height = "480px";
    }

    // Render with frames if animated
    const config = {
      responsive: true, displayModeBar: true, displaylogo: false,
      modeBarButtonsToRemove: ["sendDataToCloud","lasso2d","select2d","autoScale2d"],
      toImageButtonOptions: { format:"png", scale:2, filename:ch.title||"chart" },
    };
    if (isAnimated && ch.figure.frames) {
      Plotly.newPlot(div, ch.figure.data || [], layout, config).then(() => {
        Plotly.addFrames(div, ch.figure.frames);
      });
    } else {
      Plotly.newPlot(div, ch.figure.data || [], layout, config);
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

// ── KPI formatting ──
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

// ── Export HTML ──
async function doExportHTML() {
  if (!S.dash) return;
  const btn = document.getElementById("btn-export-html");
  const orig = btn.innerHTML;
  btn.innerHTML = '<span>⏳ Exporting…</span>';
  btn.style.pointerEvents = "none";
  try {
    const r = await fetch(`${API}/api/export/html`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dashboard: S.dash }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error("Export failed");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = (S.dash.title||"dashboard").replace(/\W+/g,"_") + ".html"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { alert("Export failed: " + e.message); }
  finally { btn.innerHTML = orig; btn.style.pointerEvents = ""; }
}

// ── Export PNG ──
function doExportPNG() {
  const charts = S.dash?.charts || [];
  if (!charts.length) { alert("Generate a dashboard first."); return; }
  const base = (S.dash?.title || "chart").replace(/\W+/g, "_");
  charts.forEach((c, i) => {
    const div = document.getElementById("plt-" + i);
    if (!div) return;
    setTimeout(() => {
      try {
        Plotly.downloadImage(div, {
          format:"png", scale:2, filename:`${base}_${i+1}`,
          width:i===0?1400:900, height:i===0?660:480
        });
      } catch {}
    }, i * 800);
  });
}

// ── UI helpers ──
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
}
