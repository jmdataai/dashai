"use strict";
const API = window.DASHAI_API || "http://localhost:7860";

// ── State ─────────────────────────────────────────────────────
const S = { datasetId:null, dashboard:null, fileName:"", genTimer:null };

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  document.getElementById("file-input").addEventListener("change", e => e.target.files[0] && handleUpload(e.target.files[0]));
});

async function checkHealth() {
  const dot=document.querySelector(".ai-dot"), txt=document.querySelector(".ai-txt");
  try {
    const r=await fetch(`${API}/health`,{signal:AbortSignal.timeout(6000)});
    if(r.ok){const d=await r.json();const active=Object.entries(d.providers||{}).filter(([,v])=>v);dot.classList.add(active.length?"online":"warn");txt.textContent=active.length?"AI ready":"No API keys";}
  } catch { dot.style.background="var(--dim)"; txt.textContent="Backend offline"; }
}

// ── Drag & drop ───────────────────────────────────────────────
const dz=document.getElementById("dropzone");
dz.addEventListener("dragover",e=>{e.preventDefault();dz.classList.add("over");});
dz.addEventListener("dragleave",()=>dz.classList.remove("over"));
dz.addEventListener("drop",e=>{e.preventDefault();dz.classList.remove("over");e.dataTransfer.files[0]&&handleUpload(e.dataTransfer.files[0]);});
dz.addEventListener("click",()=>document.getElementById("file-input").click());

// ── Upload file to backend ────────────────────────────────────
async function handleUpload(file) {
  const ext=file.name.split(".").pop().toLowerCase();
  if(!["csv","xlsx","xls"].includes(ext)){showErr("Use CSV or XLSX files.");return;}
  clearErr(); S.datasetId=null; S.dashboard=null;
  S.fileName=file.name;
  setSt("Uploading & profiling…");

  try {
    const fd=new FormData(); fd.append("file",file);
    const r=await fetch(`${API}/api/upload`,{method:"POST",body:fd,signal:AbortSignal.timeout(30000)});
    if(!r.ok){const e=await r.json().catch(()=>({detail:"Upload failed"}));throw new Error(e.detail||"Upload failed");}
    const data=await r.json();
    S.datasetId=data.id;
    showFileInfo(data);
    renderColChips(data.columns);
    clearSt();
    document.getElementById("gen-btn").disabled=false;
    // Auto-generate
    doGenerate();
  } catch(e) { clearSt(); showErr(e.message); }
}

// ── Load sample dataset ───────────────────────────────────────
async function loadSample(name) {
  clearErr(); setSt("Loading sample…");
  try {
    const r=await fetch(`${API}/api/sample/${name}`,{method:"POST"});
    if(!r.ok) throw new Error("Could not load sample");
    const data=await r.json();
    S.datasetId=data.id; S.fileName=data.filename;
    showFileInfo(data); renderColChips(data.columns); clearSt();
    document.getElementById("gen-btn").disabled=false;
    doGenerate();
  } catch(e) { clearSt(); showErr(e.message); }
}

// ── Generate dashboard ────────────────────────────────────────
async function doGenerate() {
  if(!S.datasetId) return;
  clearErr();
  const ov=document.getElementById("gen-overlay"); ov.classList.add("show");
  document.getElementById("page-upload").style.display="none";
  document.getElementById("page-dashboard").classList.add("show");
  document.getElementById("tb-title").textContent=S.fileName;

  const steps=["Analyzing data structure…","AI selecting charts…","Building visualizations…","Rendering dashboard…"];
  let si=0; document.getElementById("gen-label").textContent=steps[0];
  S.genTimer=setInterval(()=>{si=(si+1)%steps.length;document.getElementById("gen-label").textContent=steps[si];},1800);

  try {
    const r=await fetch(`${API}/api/generate/${S.datasetId}`,{
      method:"POST",headers:{"Content-Type":"application/json"},body:"{}",
      signal:AbortSignal.timeout(60000)
    });
    if(!r.ok) throw new Error("Generate failed: "+r.status);
    S.dashboard=await r.json();
  } catch(e) {
    clearInterval(S.genTimer); ov.classList.remove("show");
    showErr(e.message); return;
  }

  clearInterval(S.genTimer); ov.classList.remove("show");
  document.getElementById("tb-badge").textContent=`${S.dashboard.provider} · ${S.dashboard.charts?.length||0} charts`;
  renderDashboard(S.dashboard);
}

// ── Render dashboard ──────────────────────────────────────────
function renderDashboard(d) {
  const canvas=document.getElementById("dash-canvas"); canvas.innerHTML="";

  // Header
  const hdr=el("div","dash-hdr fade-up");
  hdr.innerHTML=`<div class="dash-hdr-title">${d.title||"Dashboard"}</div><div class="dash-hdr-sub">${d.subtitle||""}</div>`;
  canvas.appendChild(hdr);

  // KPIs
  if(d.kpis&&d.kpis.length){
    const grid=el("div","kpi-grid fade-up d1");
    const colors=["#22d3ee","#a78bfa","#10b981","#f59e0b","#5b6ef5","#f87171"];
    const icons=["💰","📈","🎯","📦","⚡","🔢"];
    d.kpis.forEach((k,i)=>{
      const card=el("div","kpi-card");
      card.style.setProperty("--kc",colors[i%colors.length]);
      card.innerHTML=`<div class="kpi-top"><div class="kpi-lbl">${k.label}</div><div class="kpi-ico">${icons[i%icons.length]}</div></div><div class="kpi-val">${fmtKPI(k.value,k.format)}</div><div class="kpi-sub">${k.column?k.metric+" of "+k.column:"total records"}</div>`;
      grid.appendChild(card);
    });
    canvas.appendChild(grid);
  }

  // Charts - hero first, then grid
  const hero=d.charts?.find(c=>c.span>=2)||d.charts?.[0];
  const subs=(d.charts||[]).filter(c=>c!==hero);

  if(hero){
    const sec=el("div","hero-section fade-up d2");
    sec.appendChild(makeChartCard(hero,"hero",0));
    canvas.appendChild(sec);
  }
  if(subs.length){
    const grid=el("div","sub-grid fade-up d3");
    subs.forEach((c,i)=>grid.appendChild(makeChartCard(c,"sub",i+1)));
    canvas.appendChild(grid);
  }

  // Footer
  const foot=el("div","dash-footer");
  foot.textContent=`DashAI · ${new Date().toLocaleDateString()} · powered by ${d.provider}`;
  canvas.appendChild(foot);

  // Render Plotly figures after DOM settles
  setTimeout(()=>{
    (d.charts||[]).forEach((c,i)=>{
      const div=document.getElementById("plt-"+i);
      if(!div||!c.figure) return;
      try{
        Plotly.newPlot(div,c.figure.data||[],
          {...(c.figure.layout||{}),autosize:true},
          {responsive:true,displayModeBar:true,displaylogo:false,
           modeBarButtonsToRemove:["sendDataToCloud","lasso2d","select2d"],
           toImageButtonOptions:{format:"png",scale:2,filename:c.title||"chart"}});
      }catch(e){console.error("Plot error:",e);}
    });
  },120);
}

function makeChartCard(chart,type,idx){
  const card=el("div","chart-card");
  const hd=el("div","chart-hd");
  hd.innerHTML=`<span class="chart-title">${chart.title||""}</span>`;
  card.appendChild(hd);
  if(chart.subtitle){const s=el("div","chart-insight");s.textContent=chart.subtitle;card.appendChild(s);}
  const pDiv=document.createElement("div");
  pDiv.id="plt-"+idx;
  pDiv.style.cssText=`width:100%;height:${type==="hero"?"400px":"300px"}`;
  card.appendChild(pDiv);
  return card;
}

// ── Formatting ────────────────────────────────────────────────
function fmtKPI(n,fmt){
  try{
    const v=typeof n==="string"?parseFloat(n):n;
    if(isNaN(v)) return String(n);
    if(fmt==="currency"){
      if(Math.abs(v)>=1e9) return`$${(v/1e9).toFixed(2)}B`;
      if(Math.abs(v)>=1e6) return`$${(v/1e6).toFixed(2)}M`;
      if(Math.abs(v)>=1e3) return`$${(v/1e3).toFixed(1)}K`;
      return`$${v.toFixed(0)}`;
    }
    if(fmt==="percent") return`${v.toFixed(1)}%`;
    if(Math.abs(v)>=1e6) return`${(v/1e6).toFixed(2)}M`;
    if(Math.abs(v)>=1e3) return`${(v/1e3).toFixed(1)}K`;
    if(Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2);
  }catch{return String(n);}
}

// ── Export PNG ─────────────────────────────────────────────────
function doExportPNG(){
  const divs=document.querySelectorAll("[id^='plt-']");
  if(!divs.length){alert("Generate a dashboard first.");return;}
  const base=(S.dashboard?.title||"chart").replace(/\W+/g,"_");
  divs.forEach((div,i)=>setTimeout(()=>{
    try{Plotly.downloadImage(div,{format:"png",scale:2,filename:`${base}_${i+1}`,width:i===0?1400:900,height:i===0?660:480});}catch(e){}
  },i*750));
}

// ── UI helpers ────────────────────────────────────────────────
function showFileInfo(data){
  const fr=document.getElementById("file-row");
  document.getElementById("file-nm").textContent=data.filename;
  document.getElementById("ft-rows").textContent=data.rows.toLocaleString()+" rows";
  document.getElementById("ft-cols").textContent=data.cols+" cols";
  fr.classList.add("show");
}
function renderColChips(columns){
  const wrap=document.getElementById("col-chips"); wrap.innerHTML="";
  (columns||[]).forEach(c=>{
    const tp=c.semantic==="numeric"?"n":c.semantic==="datetime"?"d":"c";
    const lbl=c.semantic==="numeric"?"#":c.semantic==="datetime"?"DT":"T";
    const d=document.createElement("div"); d.className="col-chip";
    d.innerHTML=`<span class="ct ct-${tp}">${lbl}</span>${c.name}`; wrap.appendChild(d);
  });
  wrap.classList.add("show");
}
function setSt(msg){document.getElementById("st-bar").classList.add("show");document.getElementById("st-txt").textContent=msg;}
function clearSt(){document.getElementById("st-bar").classList.remove("show");}
function showErr(msg){clearSt();const e=document.getElementById("err-bar");e.textContent="⚠ "+msg;e.classList.add("show");}
function clearErr(){document.getElementById("err-bar").classList.remove("show");}
function el(tag,cls){const e=document.createElement(tag);if(cls)e.className=cls;return e;}
function goBack(){document.getElementById("page-dashboard").classList.remove("show");document.getElementById("page-upload").style.display="flex";}
