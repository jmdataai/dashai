/**
 * DashAI — main.js
 * Upload → Profile → Backend AI → Render Geckoboard-style dashboard
 */

"use strict";

// ── Config ───────────────────────────────────────────────────
// Change this to your HuggingFace Space URL when deployed.
// e.g. "https://your-name-dashai.hf.space"
const API_BASE = window.DASHAI_API || "http://localhost:8000";

// ── State ────────────────────────────────────────────────────
const S = {
  data:     null,   // array of row objects
  headers:  [],
  profile:  [],     // ColProfile[]
  spec:     null,   // dashboard spec from backend
  fileName: "",
  fileSize: "",
  genTimer: null,
};

// ── DOM refs ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ============================================================
// BOOT
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  $("file-input").addEventListener("change", e => e.target.files[0] && handleFile(e.target.files[0]));
});

async function checkHealth() {
  try {
    const r = await fetch(`${API_BASE}/health`, { method: "GET", signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d = await r.json();
      const active = Object.entries(d.providers).filter(([,v]) => v).map(([k]) => k);
      const el = $("ai-status");
      if (active.length) {
        el.querySelector(".pill-dot").style.background = "#10b981";
        el.querySelector(".pill-dot").style.boxShadow  = "0 0 6px #10b981";
        el.querySelector(".pill-text").textContent = `AI ready · ${active[0]}`;
      } else {
        el.querySelector(".pill-text").textContent = "No API keys set";
        el.querySelector(".pill-dot").style.background = "#f59e0b";
      }
    }
  } catch {
    // backend offline — still let user upload; will show error at generate
  }
}

// ============================================================
// DRAG & DROP
// ============================================================
const dz = $("dropzone");
dz.addEventListener("dragover",  e => { e.preventDefault(); dz.classList.add("drag"); });
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop",      e => { e.preventDefault(); dz.classList.remove("drag"); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); });
dz.addEventListener("click",     () => $("file-input").click());

// ============================================================
// FILE HANDLING
// ============================================================
async function handleFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(ext)) { showErr("Use CSV or XLSX files only."); return; }

  clearErr(); clearStatus();
  S.fileName = file.name;
  S.fileSize = (file.size / 1024).toFixed(1);
  S.spec = null;

  setSt("Reading file...");
  try {
    const { data, headers } = await parseFile(file);
    if (!data.length) throw new Error("File appears empty.");

    S.data = data; S.headers = headers;
    setSt("Profiling columns...");
    await delay(60);
    S.profile = profileData(data, headers);

    showFileInfo();
    renderColChips();
    clearStatus();
    $("gen-btn").disabled = false;
  } catch (e) {
    clearStatus(); showErr(e.message);
  }
}

function parseFile(file) {
  return new Promise((res, rej) => {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "csv") {
      const fr = new FileReader();
      fr.onload = e => {
        const r = Papa.parse(e.target.result, { header: true, skipEmptyLines: true, dynamicTyping: false });
        r.data.length ? res({ data: r.data, headers: r.meta.fields || [] }) : rej(new Error("Empty CSV"));
      };
      fr.onerror = () => rej(new Error("File read error"));
      fr.readAsText(file);
    } else {
      const fr = new FileReader();
      fr.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { defval: "" });
          const headers = data.length ? Object.keys(data[0]) : [];
          res({ data: data.map(r => Object.fromEntries(Object.entries(r).map(([k,v]) => [k, String(v)]))), headers });
        } catch (ex) { rej(ex); }
      };
      fr.onerror = () => rej(new Error("File read error"));
      fr.readAsArrayBuffer(file);
    }
  });
}

// ============================================================
// DATA PROFILING (runs in browser — zero server calls)
// ============================================================
function profileData(rows, headers) {
  return headers.map(col => {
    const vals  = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== "");
    const nums  = vals.map(v => parseFloat(v)).filter(v => !isNaN(v));
    const isNum = nums.length > vals.length * 0.72 && vals.length > 0;
    const dtSmp = vals.slice(0, 30).filter(v => !isNaN(new Date(v).getTime()) && isNaN(parseFloat(v)));
    const isDt  = dtSmp.length >= 16 && !isNum;
    const uniq  = [...new Set(vals)];
    return {
      name:   col,
      type:   isDt ? "datetime" : isNum ? "numeric" : "categorical",
      unique: uniq.length,
      nulls:  rows.length - vals.length,
      min:    isNum ? +Math.min(...nums).toFixed(4) : null,
      max:    isNum ? +Math.max(...nums).toFixed(4) : null,
      mean:   isNum ? +(nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(4) : null,
      sum:    isNum ? +(nums.reduce((a,b)=>a+b,0)).toFixed(2) : null,
      sample: uniq.slice(0, 6).map(String),
    };
  });
}

// ============================================================
// DEMO DATASET
// ============================================================
function loadDemo() {
  function srand(seed) { let s=seed|0; return ()=>{ s=(s*1664525+1013904223)|0; return (s>>>0)/0xffffffff; }; }
  const rng = srand(42);
  const months   = ["Jan 2024","Feb 2024","Mar 2024","Apr 2024","May 2024","Jun 2024","Jul 2024","Aug 2024","Sep 2024","Oct 2024","Nov 2024","Dec 2024"];
  const regions  = ["North","South","East","West"];
  const products = ["Premium","Standard","Basic"];
  const base     = { Premium:52000, Standard:34000, Basic:21000 };
  const rmul     = { North:1.22, South:0.87, East:1.1, West:0.98 };
  const rows = [];
  months.forEach((month,mi) =>
    regions.forEach(region =>
      products.forEach(product => {
        const rev   = Math.round(base[product]*rmul[region]*(1+mi*.019)*(1+.12*Math.sin(mi/11*Math.PI))*(.87+rng()*.26));
        const units = Math.round(rev/(product==="Premium"?520:product==="Standard"?340:215));
        rows.push({ Month:month, Region:region, Product:product, Revenue:rev, Units_Sold:units, Profit_Margin:Math.round((12+rng()*18)*10)/10, Customer_Score:Math.round((3.5+rng()*1.4)*10)/10 });
      })
    )
  );
  S.data = rows;
  S.headers = ["Month","Region","Product","Revenue","Units_Sold","Profit_Margin","Customer_Score"];
  S.fileName = "Monthly_Sales_Demo.csv";
  S.fileSize = "18";
  S.profile = profileData(rows, S.headers);
  showFileInfo();
  renderColChips();
  $("gen-btn").disabled = false;
}

// ============================================================
// UI HELPERS
// ============================================================
function showFileInfo() {
  const fi = $("file-info");
  fi.querySelector(".fi-name").textContent = S.fileName;
  fi.querySelectorAll(".fi-tag")[0].textContent = `${S.data.length.toLocaleString()} rows`;
  fi.querySelectorAll(".fi-tag")[1].textContent = `${S.headers.length} cols`;
  fi.querySelectorAll(".fi-tag")[2].textContent = `${S.fileSize} KB`;
  fi.classList.add("show");
}

function renderColChips() {
  const wrap = $("col-chips");
  wrap.innerHTML = "";
  S.profile.forEach(c => {
    const tp  = c.type === "numeric" ? "n" : c.type === "datetime" ? "d" : "c";
    const lbl = c.type === "numeric" ? "#" : c.type === "datetime" ? "DT" : "T";
    const el  = document.createElement("div");
    el.className = "col-chip";
    el.innerHTML = `<span class="chip-type ${tp}">${lbl}</span>${c.name}`;
    wrap.appendChild(el);
  });
  wrap.classList.add("show");
}

function setSt(msg)     { const r=$("status-row"); r.classList.add("show"); r.querySelector(".st-msg").textContent=msg; }
function clearStatus()  { $("status-row").classList.remove("show"); }
function showErr(msg)   { clearStatus(); const e=$("err-row"); e.textContent="⚠ "+msg; e.classList.add("show"); }
function clearErr()     { $("err-row").classList.remove("show"); }
function delay(ms)      { return new Promise(r => setTimeout(r,ms)); }

// ============================================================
// GENERATE — calls backend → renders dashboard
// ============================================================
async function doGenerate() {
  if (!S.data) return;
  clearErr();

  // Show generate overlay
  const ov = $("gen-overlay");
  ov.classList.add("show");
  const steps=["Profiling your data structure…","Identifying key patterns…","Selecting optimal charts…","Designing the layout…","Almost ready…"];
  let si=0;
  const dots = ov.querySelectorAll(".gen-dot");
  function rotateDots() { dots.forEach((d,i)=>d.classList.toggle("on",i===si%dots.length)); }
  rotateDots();
  S.genTimer = setInterval(() => { si++; $("gen-msg-text").textContent=steps[si%steps.length]; rotateDots(); }, 1700);

  // Show dashboard page (hidden behind overlay)
  $("page-upload").style.display = "none";
  $("page-dashboard").classList.add("show");
  $("dash-title-nav").textContent = S.fileName;
  $("dash-file-tag").textContent = `${S.data.length.toLocaleString()} rows`;

  try {
    const body = {
      columns:     S.profile,
      row_count:   S.data.length,
      sample_rows: S.data.slice(0, 8),
    };
    const r = await fetch(`${API_BASE}/api/generate-spec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`Backend returned ${r.status}`);
    S.spec = await r.json();
  } catch (e) {
    console.warn("[DashAI] Backend error:", e.message, "— using frontend fallback");
    S.spec = frontendFallback();
  }

  clearInterval(S.genTimer);
  ov.classList.remove("show");
  renderDashboard(S.spec);
}

// ============================================================
// FRONTEND FALLBACK (if backend unreachable)
// ============================================================
function frontendFallback() {
  const num = S.profile.filter(c => c.type === "numeric");
  const cat = S.profile.filter(c => c.type === "categorical");
  const dt  = S.profile.filter(c => c.type === "datetime");
  const COLORS = ["#06b6d4","#8b5cf6","#10b981","#f59e0b"];
  const ICONS  = ["💰","📈","🎯","📦"];
  const kpis  = num.slice(0,4).map((c,i) => ({
    label: c.name.replace(/_/g," "),
    column: c.name,
    agg: /revenue|sales|profit|amount|total|cost/i.test(c.name) ? "sum" : "mean",
    format: /revenue|sales|profit|amount|cost|price/i.test(c.name) ? "currency" : "number",
    color: COLORS[i], icon: ICONS[i],
  }));
  const charts = [];
  if (dt.length && num.length)
    charts.push({id:"hero",type:"line",x:dt[0].name,y:num[0].name,title:`${num[0].name.replace(/_/g," ")} Over Time`,insight:"Trend over the full period",size:"hero",animated:true});
  else if (cat.length && num.length)
    charts.push({id:"hero",type:"bar",x:cat[0].name,y:num[0].name,title:`${num[0].name.replace(/_/g," ")} by ${cat[0].name.replace(/_/g," ")}`,insight:"Performance by category",size:"hero",animated:false});
  else if (num.length >= 2)
    charts.push({id:"hero",type:"scatter",x:num[0].name,y:num[1].name,title:`${num[0].name} vs ${num[1].name}`,insight:"Correlation between variables",size:"hero",animated:false});

  if (cat.length && num.length)
    charts.push({id:"c2",type:"pie",values:num[0].name,labels:cat[0].name,x:null,y:null,title:`${cat[0].name.replace(/_/g," ")} Breakdown`,insight:"Proportional distribution",size:"medium",animated:false});
  if (num.length > 1)
    charts.push({id:"c3",type:"histogram",x:num[Math.min(1,num.length-1)].name,y:null,title:"Value Distribution",insight:"Frequency spread",size:"medium",animated:false});
  if (num.length >= 2)
    charts.push({id:"c4",type:"box",x:null,y:num.slice(0,4).map(c=>c.name),title:"Statistical Comparison",insight:"Quartile overview",size:"medium",animated:false});
  if (num.length >= 3)
    charts.push({id:"c5",type:"heatmap",x:null,y:null,z:null,title:"Correlation Matrix",insight:"Feature relationships",size:"medium",animated:false});

  return {
    title: "Data Overview Dashboard",
    summary: `${S.data.length.toLocaleString()} records across ${S.profile.length} dimensions`,
    insights: [
      `${num.length} numeric and ${cat.length} categorical columns found`,
      num[0] ? `${num[0].name} ranges ${fmt(num[0].min)} – ${fmt(num[0].max)}` : "Explore your data",
      cat[0] ? `${cat[0].name} has ${cat[0].unique} unique values` : "Multiple dimensions available",
    ],
    kpis, charts,
  };
}

// ============================================================
// COMPUTE KPI VALUE FROM RAW DATA
// ============================================================
function computeKPI(kpi) {
  const vals = S.data.map(r => parseFloat(r[kpi.column])).filter(v => !isNaN(v));
  if (!vals.length) return { val: "—", sub: "" };
  const agg = kpi.agg;
  let v;
  if (agg === "sum")   v = vals.reduce((a,b) => a+b, 0);
  else if (agg === "mean") v = vals.reduce((a,b) => a+b, 0) / vals.length;
  else if (agg === "max")  v = Math.max(...vals);
  else if (agg === "min")  v = Math.min(...vals);
  else if (agg === "count") v = vals.length;
  else v = vals.reduce((a,b) => a+b, 0);
  const col = S.profile.find(c => c.name === kpi.column);
  const sub = col ? `avg ${fmt(col.mean)} · range ${fmt(col.min)}–${fmt(col.max)}` : "";
  return { val: fmtKPI(v, kpi.format), sub };
}

function fmtKPI(n, format) {
  if (format === "currency") {
    if (Math.abs(n) >= 1e9) return `$${(n/1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  }
  if (format === "percent") return `${n.toFixed(1)}%`;
  return fmt(n);
}

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (Math.abs(n) >= 1e9) return (n/1e9).toFixed(1)+"B";
  if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(1)+"M";
  if (Math.abs(n) >= 1e3) return (n/1e3).toFixed(1)+"K";
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(1);
}

// ============================================================
// CHART DATA BUILDERS
// ============================================================
const PAL = ["#6366f1","#06b6d4","#8b5cf6","#10b981","#f59e0b","#ef4444","#ec4899","#14b8a6","#f97316","#84cc16"];

function aggCol(xCol, yCol, max=25) {
  const agg = {};
  S.data.forEach(r => {
    const k = String(r[xCol] ?? "");
    const v = parseFloat(r[yCol]);
    if (!agg[k]) agg[k] = { s:0, n:0 };
    if (!isNaN(v)) { agg[k].s += v; agg[k].n++; } else agg[k].n++;
  });
  return Object.entries(agg).map(([k,v]) => ({ x:k, y: v.s !== 0 ? v.s/v.n : v.n })).sort((a,b) => b.y-a.y).slice(0,max);
}

function gcol(col)  { return col && col !== "null" ? S.data.map(r => r[col]) : null; }
function gnum(col)  { return col && col !== "null" ? S.data.map(r => parseFloat(r[col])).filter(v => !isNaN(v)) : null; }
function gnumRaw(col) { return S.data.map(r => parseFloat(r[col])); }

function buildTraces(spec) {
  try {
    switch (spec.type) {
      case "bar": {
        if (!spec.x || !spec.y) break;
        const d = aggCol(spec.x, spec.y, 22);
        return [{ type:"bar", x:d.map(v=>v.x), y:d.map(v=>v.y),
          marker:{ color:d.map((_,i)=>PAL[i%PAL.length]), opacity:.92 },
          hovertemplate:"<b>%{x}</b><br>%{y:,.2f}<extra></extra>" }];
      }
      case "line": {
        if (!spec.x || !spec.y) break;
        const xv = gcol(spec.x), yv = gcol(spec.y);
        const pairs = xv.map((x,i) => ({ x, y:parseFloat(yv[i]) })).filter(p=>!isNaN(p.y)).sort((a,b)=>a.x>b.x?1:-1);
        return [{ type:"scatter", mode:"lines+markers",
          x:pairs.map(p=>p.x), y:pairs.map(p=>p.y),
          line:{ color:"#6366f1", width:2.5, shape:"spline" },
          marker:{ size:5, color:"#818cf8" },
          fill:"tozeroy", fillcolor:"rgba(99,102,241,.08)",
          hovertemplate:"<b>%{x}</b><br>%{y:,.2f}<extra></extra>" }];
      }
      case "scatter": {
        if (!spec.x || !spec.y) break;
        const xv=gnum(spec.x), yv=gnum(spec.y);
        const n=Math.min(xv.length,yv.length,3000);
        return [{ type:"scatter", mode:"markers", x:xv.slice(0,n), y:yv.slice(0,n),
          marker:{ size:6, color:"#6366f1", opacity:.55 },
          hovertemplate:`${spec.x}: %{x:,.2f}<br>${spec.y}: %{y:,.2f}<extra></extra>` }];
      }
      case "pie": case "donut": {
        const labC=spec.labels||spec.x, valC=spec.values||spec.y;
        if (labC && valC) {
          const d=aggCol(labC,valC,12);
          return [{ type:"pie", values:d.map(v=>v.y), labels:d.map(v=>v.x), hole:.42,
            marker:{ colors:PAL, line:{ width:1.5, color:"rgba(11,17,32,.5)" } },
            textposition:"outside", automargin:true,
            hovertemplate:"<b>%{label}</b><br>%{percent}<extra></extra>" }];
        }
        break;
      }
      case "histogram": {
        const v=gnum(spec.x||spec.y);
        if (v && v.length)
          return [{ type:"histogram", x:v, nbinsx:Math.min(30,Math.ceil(Math.sqrt(v.length))),
            marker:{ color:"#6366f1", opacity:.88, line:{ color:"#4f46e5", width:.5 } },
            hovertemplate:"%{x}<br>Count: %{y}<extra></extra>" }];
        break;
      }
      case "box": {
        const cols = Array.isArray(spec.y) ? spec.y : [spec.y||spec.x].filter(Boolean);
        return cols.map((c,i) => ({
          type:"box", y:gnumRaw(c).filter(v=>!isNaN(v)), name:c.replace(/_/g," "),
          boxpoints:"outliers",
          marker:{ color:PAL[i%PAL.length], size:3 },
          line:{ color:PAL[i%PAL.length] },
          fillcolor: PAL[i%PAL.length]+"44",
        }));
      }
      case "heatmap": {
        const nCols = S.headers.filter(h => {
          const v = S.data.slice(0,60).map(r=>parseFloat(r[h]));
          return v.filter(x=>!isNaN(x)).length > 38;
        }).slice(0,10);
        if (nCols.length < 2) break;
        const gv  = col => S.data.map(r=>parseFloat(r[col])).filter(v=>!isNaN(v));
        const cr  = (a,b) => {
          const n=Math.min(a.length,b.length), ma=a.slice(0,n).reduce((s,v)=>s+v,0)/n, mb=b.slice(0,n).reduce((s,v)=>s+v,0)/n;
          const num=a.slice(0,n).reduce((s,v,i)=>s+(v-ma)*(b[i]-mb),0);
          const da=Math.sqrt(a.slice(0,n).reduce((s,v)=>s+(v-ma)**2,0)), db=Math.sqrt(b.slice(0,n).reduce((s,v)=>s+(v-mb)**2,0));
          return da*db===0?0:Math.round(num/(da*db)*100)/100;
        };
        const cd=nCols.map(gv), z=nCols.map((_,i)=>nCols.map((__,j)=>cr(cd[i],cd[j])));
        return [{ type:"heatmap", z, x:nCols, y:nCols,
          colorscale:[[0,"#ef4444"],[0.5,"#162032"],[1,"#6366f1"]], zmid:0,
          text:z.map(row=>row.map(v=>v.toFixed(2))), texttemplate:"%{text}", textfont:{size:10}, showscale:true }];
      }
      case "scatter3d": {
        const xv=gnum(spec.x), yv=gnum(spec.y), zv=spec.z&&spec.z!=="null"?gnum(spec.z):null;
        if (!xv||!yv) break;
        const n=Math.min(xv.length,yv.length,zv?zv.length:Infinity,2000);
        return [{ type:"scatter3d", mode:"markers",
          x:xv.slice(0,n), y:yv.slice(0,n), z:zv?zv.slice(0,n):xv.map((_,i)=>i),
          marker:{ size:3.5, color:xv.slice(0,n), colorscale:"Viridis", opacity:.8, showscale:false } }];
      }
    }
  } catch (e) { console.error("buildTraces:", e, spec); }
  return [{ type:"bar", x:[], y:[], marker:{ color:"#6366f1" } }];
}

function baseLayout() {
  return {
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { color:"#8899a6", family:"Inter,system-ui,sans-serif", size:11 },
    margin: { t:8, r:18, b:44, l:50, pad:2 },
    xaxis: { gridcolor:"#1e2e47", linecolor:"#1e2e47", tickfont:{ color:"#4a6070", size:10 }, zeroline:false, tickangle:-20 },
    yaxis: { gridcolor:"#1e2e47", linecolor:"#1e2e47", tickfont:{ color:"#4a6070", size:10 }, zeroline:false },
    hoverlabel: { bgcolor:"#1a2844", bordercolor:"#253854", font:{ color:"#f0f4f8", size:12 } },
    autosize: true, bargap: .18,
    showlegend: false,
  };
}

const PLOT_OPTS = {
  responsive: true,
  displayModeBar: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["sendDataToCloud","lasso2d","select2d","autoScale2d"],
  toImageButtonOptions: { format:"png", scale:2 },
};

// Animated progressive draw for line charts
function plotAnimated(div, spec) {
  const traces = buildTraces(spec);
  const layout = buildLayout(spec);
  if (!traces[0]?.x?.length) { Plotly.newPlot(div, traces, layout, PLOT_OPTS); return; }
  const fx=traces[0].x, fy=traces[0].y;
  Plotly.newPlot(div,[{...traces[0],x:[fx[0]],y:[fy[0]]}],layout,PLOT_OPTS);
  let idx=1;
  const step=Math.max(1,Math.ceil(fx.length/55));
  const iv=setInterval(()=>{
    const end=Math.min(idx+step,fx.length);
    try { Plotly.extendTraces(div,{x:[fx.slice(idx,end)],y:[fy.slice(idx,end)]},[0]); } catch(e){}
    idx=end; if(idx>=fx.length) clearInterval(iv);
  },28);
}

function buildLayout(spec) {
  const lo = baseLayout();
  if (["pie","donut"].includes(spec.type)) { lo.margin={t:10,r:110,b:10,l:10}; delete lo.xaxis; delete lo.yaxis; }
  if (spec.type==="scatter3d")  { lo.scene={bgcolor:"rgba(0,0,0,0)",xaxis:{title:spec.x},yaxis:{title:spec.y},zaxis:{title:spec.z||"Z"}}; lo.margin={t:0,r:0,b:0,l:0}; }
  if (["box"].includes(spec.type)) lo.showlegend=true;
  return lo;
}

// Sparkline for KPI card (very minimal)
function plotSparkline(el, col) {
  const raw = gnumRaw(col).filter(v=>!isNaN(v));
  if (!raw.length) return;
  const traces = [{ type:"scatter", mode:"lines", y:raw, line:{ color:el.dataset.color||"#06b6d4", width:2, shape:"spline" }, fill:"tozeroy", fillcolor:(el.dataset.color||"#06b6d4")+"22" }];
  const layout = { ...baseLayout(), margin:{t:0,r:0,b:0,l:0,pad:0}, height:44, showlegend:false, xaxis:{visible:false}, yaxis:{visible:false} };
  Plotly.newPlot(el, traces, layout, { displayModeBar:false, responsive:true, staticPlot:true });
}

// ============================================================
// RENDER DASHBOARD
// ============================================================
function renderDashboard(spec) {
  const canvas = $("dash-canvas");
  canvas.innerHTML = "";

  // — Header
  const hd = el("div","dash-head fade-up");
  hd.innerHTML = `<div class="dash-head-title">${spec.title||"Dashboard"}</div><div class="dash-head-sub">${spec.summary||""}</div>`;
  canvas.appendChild(hd);

  // — KPI Grid
  if (spec.kpis && spec.kpis.length) {
    const grid = el("div","kpi-grid fade-up delay-1");
    spec.kpis.forEach(kpi => {
      const { val, sub } = computeKPI(kpi);
      const col   = S.profile.find(c => c.name === kpi.column);
      const pct   = col && col.max && col.min && col.mean ? Math.round(((col.mean-col.min)/(col.max-col.min))*100) : null;
      const card  = el("div","kpi-card");
      card.style.setProperty("--kc", kpi.color||"#06b6d4");
      card.innerHTML = `
        <div class="kpi-top">
          <div class="kpi-label">${kpi.label}</div>
          <div class="kpi-icon">${kpi.icon||"📊"}</div>
        </div>
        <div class="kpi-value">${val}</div>
        <div class="kpi-sub">${sub}</div>
        ${pct !== null ? `<div class="kpi-prog"><div class="kpi-prog-fill" style="width:${pct}%"></div></div>` : ""}
        <div class="kpi-spark" data-col="${kpi.column}" data-color="${kpi.color||"#06b6d4"}"></div>`;
      grid.appendChild(card);
    });
    canvas.appendChild(grid);
  }

  // — Insights bar
  if (spec.insights && spec.insights.length) {
    const bar = el("div","insights-bar fade-up delay-2");
    spec.insights.forEach(ins => {
      const chip = el("div","insight-chip");
      chip.innerHTML = `<span>💡</span>${ins}`;
      bar.appendChild(chip);
    });
    canvas.appendChild(bar);
  }

  // — Hero chart
  if (spec.charts && spec.charts[0]) {
    const sec = el("div","hero-section fade-up delay-2");
    sec.appendChild(makeChartCard(spec.charts[0], true));
    canvas.appendChild(sec);
  }

  // — Sub-grid
  if (spec.charts && spec.charts.length > 1) {
    const grid = el("div","sub-grid fade-up delay-3");
    spec.charts.slice(1).forEach(c => grid.appendChild(makeChartCard(c, false)));
    canvas.appendChild(grid);
  }

  // — Footer
  const foot = el("div","dash-footer");
  foot.textContent = `DashAI · ${new Date().toLocaleDateString()} · ${S.data.length.toLocaleString()} rows · ${spec.charts?.length||0} charts`;
  canvas.appendChild(foot);

  // — Plot everything after DOM settles
  setTimeout(() => {
    // Sparklines
    document.querySelectorAll(".kpi-spark[data-col]").forEach(el => {
      el.style.color = el.dataset.color;
      plotSparkline(el, el.dataset.col);
    });
    // Main charts
    (spec.charts||[]).forEach((c,i) => {
      const div = $("plt"+i);
      if (!div) return;
      try {
        const shouldAnim = c.animated && ["line","scatter"].includes(c.type) && c.x && [...new Set(S.data.map(r=>r[c.x]))].length >= 5;
        if (shouldAnim) plotAnimated(div, c);
        else { const traces=buildTraces(c); const layout=buildLayout(c); Plotly.newPlot(div,traces,layout,{...PLOT_OPTS,toImageButtonOptions:{...PLOT_OPTS.toImageButtonOptions,filename:c.title||"chart"}}); }
      } catch(e) { console.error("Plot error:",e,c); }
    });
  }, 150);
}

function makeChartCard(spec, isHero) {
  const idx   = S.spec.charts.indexOf(spec);
  const card  = el("div","chart-card");
  const hd    = el("div","chart-card-hd");
  const trow  = el("div","chart-card-title");
  trow.innerHTML = spec.title || "";
  if (spec.animated) {
    const badge = el("span","anim-tag"); badge.textContent = "▶ animated"; trow.appendChild(badge);
  }
  hd.appendChild(trow);
  card.appendChild(hd);
  if (spec.insight) {
    const ins = el("div","chart-card-insight"); ins.textContent = spec.insight; card.appendChild(ins);
  }
  const pDiv = document.createElement("div");
  pDiv.id = "plt"+idx;
  pDiv.style.cssText = `width:100%;height:${isHero?"390px":"280px"}`;
  card.appendChild(pDiv);
  return card;
}

function el(tag, cls) { const e=document.createElement(tag); if(cls) e.className=cls; return e; }

// ============================================================
// EXPORT — HTML
// ============================================================
function doExportHTML() {
  if (!S.spec || !S.data) return;

  const chartsData = (S.spec.charts||[]).map((c,i) => {
    try {
      const traces=buildTraces(c);
      const layout=buildLayout(c);
      return { i, traces, layout, title:c.title, insight:c.insight, isHero:i===0 };
    } catch { return { i, traces:[], layout:{}, title:c.title, insight:"", isHero:i===0 }; }
  });

  const kpiHTML = (S.spec.kpis||[]).map(kpi => {
    const { val, sub } = computeKPI(kpi);
    return `<div style="background:#141f35;border:1px solid #1e2e47;border-radius:14px;padding:20px 22px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${kpi.color||"#06b6d4"}"></div>
      <div style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8899a6;margin-bottom:10px">${kpi.label}</div>
      <div style="font-family:monospace;font-size:32px;color:#f0f4f8;letter-spacing:-1px;line-height:1">${val}</div>
      <div style="font-size:10px;color:#8899a6;margin-top:6px">${sub}</div>
    </div>`;
  }).join("");

  const chartCards = chartsData.map(c => {
    const h=c.isHero?400:290;
    const margin=c.isHero?"margin-bottom:16px":"";
    return `<div style="background:#141f35;border:1px solid #1e2e47;border-radius:14px;padding:18px;overflow:hidden;${margin}">
      <div style="font-size:13px;font-weight:600;color:#f0f4f8;margin-bottom:4px">${c.title||""}</div>
      ${c.insight?`<div style="font-size:11px;color:#8899a6;margin-bottom:10px">${c.insight}</div>`:""}
      <div id="c${c.i}" style="height:${h}px"></div>
    </div>`;
  });

  const plotJS = chartsData.map(c =>
    `try{Plotly.newPlot('c${c.i}',${JSON.stringify(c.traces)},Object.assign(${JSON.stringify(c.layout)},{autosize:true}),{responsive:true,displaylogo:false})}catch(e){}`
  ).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${S.spec.title||"Dashboard"}</title>
<script src="https://cdn.plot.ly/plotly-2.27.0.min.js"><\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=DM+Mono:wght@500&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0b1120;color:#f0f4f8;font-family:'Inter',system-ui,sans-serif;padding:32px 28px;min-height:100vh}
.wrap{max-width:1200px;margin:0 auto}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:22px}
.insight-bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}
.chip{background:#141f35;border:1px solid #1e2e47;border-radius:7px;padding:6px 12px;font-size:11.5px;color:#8899a6;line-height:1.4}
.sub-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px;margin-bottom:16px}
</style></head>
<body><div class="wrap">
<div style="margin-bottom:22px">
  <h1 style="font-size:24px;font-weight:700;letter-spacing:-.5px;margin-bottom:6px">${S.spec.title||""}</h1>
  <p style="font-size:13px;color:#8899a6;line-height:1.6">${S.spec.summary||""}</p>
</div>
<div class="kpi-grid">${kpiHTML}</div>
${(S.spec.insights||[]).length?`<div class="insight-bar">${(S.spec.insights||[]).map(i=>`<span class="chip">💡 ${i}</span>`).join("")}</div>`:""}
${chartCards[0]||""}
<div class="sub-grid">${chartCards.slice(1).join("")}</div>
<div style="text-align:center;padding:24px 0 8px;font-size:10px;color:#1e2e47">
  DashAI · Generated ${new Date().toLocaleString()} · ${S.data.length.toLocaleString()} rows
</div>
</div>
<script>${plotJS}<\/script></body></html>`;

  dlFile(html, "text/html", (S.spec.title||"dashboard").replace(/\W+/g,"_"), ".html");
}

// ============================================================
// EXPORT — PNG (staggered per chart)
// ============================================================
function doExportPNG() {
  const divs = document.querySelectorAll("[id^='plt']");
  if (!divs.length) { alert("Generate a dashboard first."); return; }
  const base = (S.spec?.title||"chart").replace(/\W+/g,"_");
  divs.forEach((div,i) => {
    setTimeout(() => {
      try { Plotly.downloadImage(div,{format:"png",scale:2,filename:`${base}_chart_${i+1}`,width:i===0?1400:900,height:i===0?660:480}); } catch(e){}
    }, i*750);
  });
}

function dlFile(content, mime, name, ext) {
  const b = new Blob([content],{type:mime});
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href=u; a.download=name+ext; a.click();
  setTimeout(()=>URL.revokeObjectURL(u),1500);
}

// ============================================================
// NAV HELPERS
// ============================================================
function goBack() {
  $("page-dashboard").classList.remove("show");
  $("page-upload").style.display = "flex";
}
