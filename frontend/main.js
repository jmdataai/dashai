"use strict";

// ── Config ────────────────────────────────────────────────────
const API_BASE = window.DASHAI_API || "http://localhost:8000";

// ── State ─────────────────────────────────────────────────────
const S = { data:null, headers:[], profile:[], spec:null, fileName:"", fileSize:"", genTimer:null };

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  document.getElementById("file-input").addEventListener("change", e => e.target.files[0] && handleFile(e.target.files[0]));
});

// ── Health check ──────────────────────────────────────────────
async function checkHealth() {
  const dot = document.querySelector(".ai-dot");
  const txt = document.querySelector(".ai-txt");
  try {
    const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const d = await r.json();
      const active = Object.entries(d.providers || {}).filter(([,v]) => v).map(([k]) => k);
      dot.classList.add(active.length ? "online" : "warn");
      txt.textContent = active.length ? "AI ready" : "No API keys set";
    } else { dot.classList.add("warn"); txt.textContent = "Backend error"; }
  } catch {
    dot.style.background = "var(--dim)";
    txt.textContent = "Offline — using local AI";
  }
}

// ── Drag & drop ───────────────────────────────────────────────
const dz = document.getElementById("dropzone");
dz.addEventListener("dragover",  e => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop",      e => { e.preventDefault(); dz.classList.remove("over"); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); });
dz.addEventListener("click",     () => document.getElementById("file-input").click());

// ── File handling ─────────────────────────────────────────────
async function handleFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["csv","xlsx","xls"].includes(ext)) { showErr("Please upload a CSV or Excel file."); return; }
  clearErr(); clearSt(); S.spec = null;
  S.fileName = file.name; S.fileSize = (file.size / 1024).toFixed(1);
  setSt("Reading file…");
  try {
    const { data, headers } = await parseFile(file);
    if (!data.length) throw new Error("The file appears to be empty.");
    S.data = data; S.headers = headers;
    setSt("Profiling columns…");
    await delay(60);
    S.profile = profileData(data, headers);
    showFileInfo();
    renderColChips();
    clearSt();
    document.getElementById("gen-btn").disabled = false;
  } catch (e) { clearSt(); showErr(e.message); }
}

function parseFile(file) {
  return new Promise((res, rej) => {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "csv") {
      const fr = new FileReader();
      fr.onload = e => {
        const r = Papa.parse(e.target.result, { header:true, skipEmptyLines:true, dynamicTyping:false });
        r.data.length ? res({ data:r.data, headers:r.meta.fields||[] }) : rej(new Error("Empty CSV"));
      };
      fr.onerror = () => rej(new Error("File read error"));
      fr.readAsText(file);
    } else {
      const fr = new FileReader();
      fr.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type:"array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { defval:"" });
          const headers = data.length ? Object.keys(data[0]) : [];
          res({ data:data.map(r => Object.fromEntries(Object.entries(r).map(([k,v]) => [k,String(v)]))), headers });
        } catch(ex) { rej(ex); }
      };
      fr.onerror = () => rej(new Error("File read error"));
      fr.readAsArrayBuffer(file);
    }
  });
}

// ── Data profiling ────────────────────────────────────────────
function profileData(rows, headers) {
  return headers.map(col => {
    const vals = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== "");
    const nums = vals.map(v => parseFloat(v)).filter(v => !isNaN(v));
    const isNum = nums.length > vals.length * 0.72 && vals.length > 0;
    const dtSmp = vals.slice(0,30).filter(v => !isNaN(new Date(v).getTime()) && isNaN(parseFloat(v)));
    const isDt  = dtSmp.length >= 16 && !isNum;
    const uniq  = [...new Set(vals)];
    return {
      name:col, type:isDt?"datetime":isNum?"numeric":"categorical",
      unique:uniq.length, nulls:rows.length-vals.length,
      min:isNum?+Math.min(...nums).toFixed(4):null,
      max:isNum?+Math.max(...nums).toFixed(4):null,
      mean:isNum?+(nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(4):null,
      sum:isNum?+(nums.reduce((a,b)=>a+b,0)).toFixed(2):null,
      sample:uniq.slice(0,6).map(String),
    };
  });
}

// ── Demo dataset ──────────────────────────────────────────────
function loadDemo() {
  function srand(seed){let s=seed|0;return()=>{s=(s*1664525+1013904223)|0;return(s>>>0)/0xffffffff;};}
  const rng=srand(42);
  const months=["Jan 2024","Feb 2024","Mar 2024","Apr 2024","May 2024","Jun 2024","Jul 2024","Aug 2024","Sep 2024","Oct 2024","Nov 2024","Dec 2024"];
  const regions=["North","South","East","West"], products=["Premium","Standard","Basic"];
  const base={Premium:52000,Standard:34000,Basic:21000}, rmul={North:1.22,South:0.87,East:1.1,West:0.98};
  const rows=[];
  months.forEach((month,mi)=>regions.forEach(region=>products.forEach(product=>{
    const rev=Math.round(base[product]*rmul[region]*(1+mi*.019)*(1+.12*Math.sin(mi/11*Math.PI))*(.87+rng()*.26));
    rows.push({Month:month,Region:region,Product:product,Revenue:rev,Units_Sold:Math.round(rev/(product==="Premium"?520:product==="Standard"?340:215)),Profit_Margin:Math.round((12+rng()*18)*10)/10,Customer_Score:Math.round((3.5+rng()*1.4)*10)/10});
  })));
  S.data=rows; S.headers=["Month","Region","Product","Revenue","Units_Sold","Profit_Margin","Customer_Score"];
  S.fileName="Monthly_Sales_Demo.csv"; S.fileSize="18";
  S.profile=profileData(rows,S.headers);
  showFileInfo(); renderColChips();
  document.getElementById("gen-btn").disabled=false;
}

// ── UI helpers ────────────────────────────────────────────────
function showFileInfo() {
  const fr=document.getElementById("file-row");
  document.getElementById("file-nm").textContent=S.fileName;
  document.getElementById("ft-rows").textContent=S.data.length.toLocaleString()+" rows";
  document.getElementById("ft-cols").textContent=S.headers.length+" cols";
  document.getElementById("ft-size").textContent=S.fileSize+" KB";
  fr.classList.add("show");
}
function renderColChips() {
  const wrap=document.getElementById("col-chips"); wrap.innerHTML="";
  S.profile.forEach(c=>{
    const tp=c.type==="numeric"?"n":c.type==="datetime"?"d":"c";
    const lbl=c.type==="numeric"?"#":c.type==="datetime"?"DT":"T";
    const d=document.createElement("div"); d.className="col-chip";
    d.innerHTML=`<span class="ct ct-${tp}">${lbl}</span>${c.name}`; wrap.appendChild(d);
  });
  wrap.classList.add("show");
}
function setSt(msg)    { const b=document.getElementById("st-bar"); b.classList.add("show"); document.getElementById("st-txt").textContent=msg; }
function clearSt()     { document.getElementById("st-bar").classList.remove("show"); }
function showErr(msg)  { clearSt(); const e=document.getElementById("err-bar"); e.textContent="⚠ "+msg; e.classList.add("show"); }
function clearErr()    { document.getElementById("err-bar").classList.remove("show"); }
function delay(ms)     { return new Promise(r=>setTimeout(r,ms)); }
function el(tag,cls)   { const e=document.createElement(tag); if(cls) e.className=cls; return e; }

// ── Generate ──────────────────────────────────────────────────
async function doGenerate() {
  if (!S.data) return;
  clearErr();

  const ov=document.getElementById("gen-overlay");
  ov.classList.add("show");
  document.getElementById("page-upload").style.display="none";
  document.getElementById("page-dashboard").classList.add("show");
  document.getElementById("tb-title").textContent=S.fileName;
  document.getElementById("tb-badge").textContent=S.data.length.toLocaleString()+" rows";

  const steps=["Analyzing data structure…","Identifying patterns…","Selecting optimal charts…","Designing layout…","Almost ready…"];
  let si=0; document.getElementById("gen-label").textContent=steps[0];
  const dots=ov.querySelectorAll(".gd");
  const rotateDots=()=>dots.forEach((d,i)=>d.classList.toggle("on",i===si%dots.length));
  rotateDots();
  S.genTimer=setInterval(()=>{si++;document.getElementById("gen-label").textContent=steps[si%steps.length];rotateDots();},1700);

  try {
    const r=await fetch(`${API_BASE}/api/generate-spec`,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({columns:S.profile,row_count:S.data.length,sample_rows:S.data.slice(0,8)}),
      signal:AbortSignal.timeout(60000),
    });
    if(!r.ok) throw new Error("Backend "+r.status);
    S.spec=await r.json();
  } catch(e) {
    console.warn("[DashAI] Backend unreachable — using local fallback:",e.message);
    S.spec=localFallback();
  }

  clearInterval(S.genTimer);
  ov.classList.remove("show");
  renderDashboard(S.spec);
  document.getElementById("gen-btn").innerHTML="↺ &nbsp;Regenerate";
}

// ── Local fallback spec ───────────────────────────────────────
function localFallback() {
  const num=S.profile.filter(c=>c.type==="numeric");
  const cat=S.profile.filter(c=>c.type==="categorical");
  const dt =S.profile.filter(c=>c.type==="datetime");
  const COLORS=["#22d3ee","#a78bfa","#10b981","#f59e0b"];
  const ICONS =["💰","📈","🎯","📦"];
  const kpis=num.slice(0,4).map((c,i)=>({
    label:c.name.replace(/_/g," "),column:c.name,
    agg:/revenue|sales|profit|amount|total|cost/i.test(c.name)?"sum":"mean",
    format:/revenue|sales|profit|amount|cost|price/i.test(c.name)?"currency":"number",
    color:COLORS[i],icon:ICONS[i],
  }));
  const charts=[];
  if(dt.length&&num.length)  charts.push({id:"hero",type:"line",x:dt[0].name,y:num[0].name,title:`${num[0].name.replace(/_/g," ")} Over Time`,insight:"Monthly trend",size:"hero",animated:true});
  else if(cat.length&&num.length) charts.push({id:"hero",type:"bar",x:cat[0].name,y:num[0].name,title:`${num[0].name.replace(/_/g," ")} by ${cat[0].name.replace(/_/g," ")}`,insight:"Category breakdown",size:"hero",animated:false});
  else if(num.length>=2) charts.push({id:"hero",type:"scatter",x:num[0].name,y:num[1].name,title:`${num[0].name} vs ${num[1].name}`,insight:"Correlation",size:"hero",animated:false});
  if(cat.length&&num.length) charts.push({id:"c2",type:"pie",values:num[0].name,labels:cat[0].name,x:null,y:null,title:`${cat[0].name.replace(/_/g," ")} Breakdown`,insight:"Proportional share",size:"medium",animated:false});
  if(num.length>1) charts.push({id:"c3",type:"histogram",x:num[Math.min(1,num.length-1)].name,y:null,title:"Value Distribution",insight:"Frequency spread",size:"medium",animated:false});
  if(num.length>=2) charts.push({id:"c4",type:"box",x:null,y:num.slice(0,4).map(c=>c.name),title:"Statistical Comparison",insight:"Quartile overview",size:"medium",animated:false});
  if(num.length>=3) charts.push({id:"c5",type:"heatmap",x:null,y:null,z:null,title:"Correlation Matrix",insight:"Feature relationships",size:"medium",animated:false});
  return {
    title:"Data Overview Dashboard",
    summary:`${S.data.length.toLocaleString()} records · ${S.profile.length} dimensions`,
    insights:[
      `${num.length} numeric and ${cat.length} categorical columns detected`,
      num[0]&&num[0].min!==null?`${num[0].name} ranges from ${fmt(num[0].min)} to ${fmt(num[0].max)}`:"Explore your dataset",
      cat[0]?`${cat[0].name} has ${cat[0].unique} unique values`:"Multiple dimensions available",
    ],
    kpis, charts,
  };
}

// ── KPI value computation ──────────────────────────────────────
function computeKPI(kpi) {
  const vals=S.data.map(r=>parseFloat(r[kpi.column])).filter(v=>!isNaN(v));
  if(!vals.length) return{val:"—",sub:""};
  let v;
  if(kpi.agg==="sum")       v=vals.reduce((a,b)=>a+b,0);
  else if(kpi.agg==="mean") v=vals.reduce((a,b)=>a+b,0)/vals.length;
  else if(kpi.agg==="max")  v=Math.max(...vals);
  else if(kpi.agg==="min")  v=Math.min(...vals);
  else if(kpi.agg==="count")v=vals.length;
  else v=vals.reduce((a,b)=>a+b,0);
  const col=S.profile.find(c=>c.name===kpi.column);
  const sub=col&&col.mean!==null?`avg ${fmt(col.mean)} · ${fmt(col.min)}–${fmt(col.max)}`:"";
  return{val:fmtKPI(v,kpi.format),sub};
}
function fmtKPI(n,format){
  if(format==="currency"){ if(Math.abs(n)>=1e9) return`$${(n/1e9).toFixed(2)}B`; if(Math.abs(n)>=1e6) return`$${(n/1e6).toFixed(2)}M`; if(Math.abs(n)>=1e3) return`$${(n/1e3).toFixed(1)}K`; return`$${n.toFixed(0)}`; }
  if(format==="percent") return`${n.toFixed(1)}%`;
  return fmt(n);
}
function fmt(n){
  if(n===null||n===undefined||isNaN(n)) return"—";
  if(Math.abs(n)>=1e9) return(n/1e9).toFixed(1)+"B";
  if(Math.abs(n)>=1e6) return(n/1e6).toFixed(1)+"M";
  if(Math.abs(n)>=1e3) return(n/1e3).toFixed(1)+"K";
  return n%1===0?String(Math.round(n)):n.toFixed(1);
}

// ── Chart helpers ─────────────────────────────────────────────
const PAL=["#5b6ef5","#22d3ee","#a78bfa","#10b981","#f59e0b","#f87171","#ec4899","#14b8a6","#f97316","#84cc16"];

/**
 * Aggregate rows by xCol, summing/averaging yCol.
 * Returns [{x, y}] sorted by count desc, capped at `max`.
 */
function aggBy(xCol, yCol, max=25) {
  const m={};
  S.data.forEach(r=>{
    const k=String(r[xCol]??"");
    const v=parseFloat(r[yCol]);
    if(!m[k]) m[k]={s:0,n:0};
    if(!isNaN(v)){m[k].s+=v;m[k].n++;}else m[k].n++;
  });
  return Object.entries(m)
    .map(([k,v])=>({x:k,y:v.s!==0?v.s/v.n:v.n}))
    .sort((a,b)=>b.y-a.y).slice(0,max);
}

/**
 * For line / time-series: aggregate by xCol (ordered) summing yCol.
 * Preserves natural order of x values (month/date order).
 */
function aggOrdered(xCol, yCol) {
  const seen=[], map={};
  S.data.forEach(r=>{
    const k=String(r[xCol]??"");
    const v=parseFloat(r[yCol]);
    if(!map[k]){map[k]={s:0,n:0};seen.push(k);}
    if(!isNaN(v)){map[k].s+=v;map[k].n++;}else map[k].n++;
  });
  // Try to parse as dates for proper chronological sort
  const tryDate=k=>new Date(k);
  const allDates=seen.every(k=>!isNaN(tryDate(k).getTime())&&isNaN(parseFloat(k)));
  if(allDates) seen.sort((a,b)=>new Date(a)-new Date(b));
  return seen.map(k=>({x:k,y:map[k].s!==0?map[k].s/map[k].n:map[k].n}));
}

function gcol(col)    { return col&&col!=="null"?S.data.map(r=>r[col]):null; }
function gnumAll(col) { return S.data.map(r=>parseFloat(r[col])); }
function gnum(col)    { return gnumAll(col).filter(v=>!isNaN(v)); }

// ── Plotly layout base ────────────────────────────────────────
function baseLayout() {
  return {
    paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)",
    font:{color:"#607090",family:"'Sora',system-ui,sans-serif",size:11},
    margin:{t:8,r:18,b:46,l:52,pad:2},
    xaxis:{gridcolor:"#1a2540",linecolor:"#1a2540",tickfont:{color:"#344560",size:10},zeroline:false,tickangle:-20},
    yaxis:{gridcolor:"#1a2540",linecolor:"#1a2540",tickfont:{color:"#344560",size:10},zeroline:false},
    hoverlabel:{bgcolor:"#141e2e",bordercolor:"#203050",font:{color:"#edf2f8",size:12}},
    autosize:true, bargap:.18, showlegend:false,
  };
}
const PLOT_OPTS={
  responsive:true, displayModeBar:true, displaylogo:false,
  modeBarButtonsToRemove:["sendDataToCloud","lasso2d","select2d","autoScale2d"],
  toImageButtonOptions:{format:"png",scale:2},
};

// ── Build Plotly traces ───────────────────────────────────────
function buildTraces(spec) {
  try {
    switch(spec.type) {
      // ── BAR: aggregate xCol grouped, y is sum/avg ──────────
      case "bar": {
        if(!spec.x||!spec.y) break;
        const d=aggBy(spec.x,spec.y,24);
        return [{type:"bar",x:d.map(v=>v.x),y:d.map(v=>v.y),
          marker:{color:d.map((_,i)=>PAL[i%PAL.length]),opacity:.92},
          hovertemplate:"<b>%{x}</b><br>%{y:,.2f}<extra></extra>"}];
      }

      // ── LINE: MUST aggregate by x first (fixes the zigzag bug) ──
      case "line": {
        if(!spec.x||!spec.y) break;
        const d=aggOrdered(spec.x,spec.y);          // ← FIX: aggregate not raw rows
        return [{type:"scatter",mode:"lines+markers",
          x:d.map(v=>v.x),y:d.map(v=>v.y),
          line:{color:"#5b6ef5",width:2.5,shape:"spline"},
          marker:{size:5,color:"#7c8fff"},
          fill:"tozeroy",fillcolor:"rgba(91,110,245,.09)",
          hovertemplate:"<b>%{x}</b><br>%{y:,.2f}<extra></extra>"}];
      }

      // ── SCATTER: raw points, numeric only ────────────────────
      case "scatter": {
        if(!spec.x||!spec.y) break;
        const xv=gnum(spec.x),yv=gnum(spec.y);
        const n=Math.min(xv.length,yv.length,3000);
        return [{type:"scatter",mode:"markers",x:xv.slice(0,n),y:yv.slice(0,n),
          marker:{size:6,color:"#5b6ef5",opacity:.55},
          hovertemplate:`${spec.x}: %{x:,.2f}<br>${spec.y}: %{y:,.2f}<extra></extra>`}];
      }

      // ── PIE / DONUT: aggregate labels→values ─────────────────
      case "pie": case "donut": {
        const labC=spec.labels||spec.x, valC=spec.values||spec.y;
        if(labC&&valC){
          const d=aggBy(labC,valC,12);
          return [{type:"pie",values:d.map(v=>v.y),labels:d.map(v=>v.x),hole:.44,
            marker:{colors:PAL,line:{width:2,color:"rgba(8,13,24,.6)"}},
            textposition:"outside",automargin:true,
            hovertemplate:"<b>%{label}</b><br>%{percent}<extra></extra>"}];
        }
        break;
      }

      // ── HISTOGRAM ─────────────────────────────────────────────
      case "histogram": {
        const v=gnum(spec.x||spec.y);
        if(v&&v.length) return [{type:"histogram",x:v,nbinsx:Math.min(30,Math.ceil(Math.sqrt(v.length))),
          marker:{color:"#5b6ef5",opacity:.88,line:{color:"#3b4fdb",width:.5}},
          hovertemplate:"%{x}<br>Count: %{y}<extra></extra>"}];
        break;
      }

      // ── BOX: multiple columns ──────────────────────────────────
      case "box": {
        const cols=Array.isArray(spec.y)?spec.y:[spec.y||spec.x].filter(Boolean);
        return cols.map((c,i)=>({type:"box",y:gnumAll(c).filter(v=>!isNaN(v)),name:c.replace(/_/g," "),
          boxpoints:"outliers",marker:{color:PAL[i%PAL.length],size:3},
          line:{color:PAL[i%PAL.length]},fillcolor:PAL[i%PAL.length]+"44"}));
      }

      // ── HEATMAP: auto correlation matrix ──────────────────────
      case "heatmap": {
        const nCols=S.headers.filter(h=>{
          const v=S.data.slice(0,60).map(r=>parseFloat(r[h]));
          return v.filter(x=>!isNaN(x)).length>38;
        }).slice(0,10);
        if(nCols.length<2) break;
        const gv=col=>S.data.map(r=>parseFloat(r[col])).filter(v=>!isNaN(v));
        const cr=(a,b)=>{
          const n=Math.min(a.length,b.length),ma=a.slice(0,n).reduce((s,v)=>s+v,0)/n,mb=b.slice(0,n).reduce((s,v)=>s+v,0)/n;
          const num=a.slice(0,n).reduce((s,v,i)=>s+(v-ma)*(b[i]-mb),0);
          const da=Math.sqrt(a.slice(0,n).reduce((s,v)=>s+(v-ma)**2,0)),db=Math.sqrt(b.slice(0,n).reduce((s,v)=>s+(v-mb)**2,0));
          return da*db===0?0:Math.round(num/(da*db)*100)/100;
        };
        const cd=nCols.map(gv),z=nCols.map((_,i)=>nCols.map((__,j)=>cr(cd[i],cd[j])));
        return [{type:"heatmap",z,x:nCols,y:nCols,
          colorscale:[[0,"#f87171"],[0.5,"#141e2e"],[1,"#5b6ef5"]],zmid:0,
          text:z.map(row=>row.map(v=>v.toFixed(2))),texttemplate:"%{text}",textfont:{size:10},showscale:true}];
      }

      // ── SCATTER 3D ────────────────────────────────────────────
      case "scatter3d": {
        const xv=gnum(spec.x),yv=gnum(spec.y),zv=spec.z&&spec.z!=="null"?gnum(spec.z):null;
        if(!xv||!yv) break;
        const n=Math.min(xv.length,yv.length,zv?zv.length:Infinity,2000);
        return [{type:"scatter3d",mode:"markers",x:xv.slice(0,n),y:yv.slice(0,n),z:zv?zv.slice(0,n):xv.map((_,i)=>i),
          marker:{size:3.5,color:xv.slice(0,n),colorscale:"Viridis",opacity:.8,showscale:false}}];
      }
    }
  } catch(e){console.error("buildTraces:",e,spec);}
  return [{type:"bar",x:[],y:[],marker:{color:"#5b6ef5"}}];
}

function buildLayout(spec) {
  const lo=baseLayout();
  if(["pie","donut"].includes(spec.type)){lo.margin={t:10,r:110,b:10,l:10};delete lo.xaxis;delete lo.yaxis;}
  if(spec.type==="scatter3d"){lo.scene={bgcolor:"rgba(0,0,0,0)",xaxis:{title:spec.x,gridcolor:"#1a2540"},yaxis:{title:spec.y,gridcolor:"#1a2540"},zaxis:{title:spec.z||"Z",gridcolor:"#1a2540"}};lo.margin={t:0,r:0,b:0,l:0};}
  if(spec.type==="box") lo.showlegend=true;
  return lo;
}

// ── Animated line: progressive draw ──────────────────────────
function plotAnimated(div, spec) {
  const traces=buildTraces(spec);     // already aggregated, correct points
  const layout=buildLayout(spec);
  if(!traces[0]?.x?.length){Plotly.newPlot(div,traces,layout,PLOT_OPTS);return;}
  const fx=traces[0].x, fy=traces[0].y;
  Plotly.newPlot(div,[{...traces[0],x:[fx[0]],y:[fy[0]]}],layout,PLOT_OPTS);
  let idx=1;
  const step=Math.max(1,Math.ceil(fx.length/60));
  const iv=setInterval(()=>{
    const end=Math.min(idx+step,fx.length);
    try{Plotly.extendTraces(div,{x:[fx.slice(idx,end)],y:[fy.slice(idx,end)]},[0]);}catch(e){}
    idx=end; if(idx>=fx.length) clearInterval(iv);
  },30);
}

// ── Sparkline inside KPI card ─────────────────────────────────
function plotSparkline(el, col, color) {
  // Aggregate by first categorical column for a meaningful trend
  const cat=S.profile.find(c=>c.type==="categorical"||c.type==="datetime");
  let ys;
  if(cat&&cat.name!==col){
    const d=aggOrdered(cat.name,col);
    ys=d.map(v=>v.y);
  } else {
    ys=gnumAll(col).filter(v=>!isNaN(v));
  }
  if(!ys.length) return;
  const traces=[{type:"scatter",mode:"lines",y:ys,line:{color:color||"#22d3ee",width:2,shape:"spline"},fill:"tozeroy",fillcolor:(color||"#22d3ee")+"22"}];
  const layout={paper_bgcolor:"rgba(0,0,0,0)",plot_bgcolor:"rgba(0,0,0,0)",margin:{t:0,r:0,b:0,l:0,pad:0},height:40,showlegend:false,xaxis:{visible:false},yaxis:{visible:false}};
  Plotly.newPlot(el,traces,layout,{displayModeBar:false,responsive:true,staticPlot:true});
}

// ── Render dashboard ──────────────────────────────────────────
function renderDashboard(spec) {
  const canvas=document.getElementById("dash-canvas");
  canvas.innerHTML="";

  // Header
  const hdr=el("div","dash-hdr fade-up");
  hdr.innerHTML=`<div class="dash-hdr-title">${spec.title||"Dashboard"}</div><div class="dash-hdr-sub">${spec.summary||""}</div>`;
  canvas.appendChild(hdr);

  // KPI grid
  if(spec.kpis&&spec.kpis.length){
    const grid=el("div","kpi-grid fade-up d1");
    spec.kpis.forEach(kpi=>{
      const {val,sub}=computeKPI(kpi);
      const col=S.profile.find(c=>c.name===kpi.column);
      const pct=col&&col.max!==null&&col.min!==null&&col.mean!==null&&col.max!==col.min?Math.round(((col.mean-col.min)/(col.max-col.min))*100):null;
      const card=el("div","kpi-card");
      card.style.setProperty("--kc",kpi.color||"#22d3ee");
      card.innerHTML=`
        <div class="kpi-top">
          <div class="kpi-lbl">${kpi.label||kpi.column}</div>
          <div class="kpi-ico">${kpi.icon||"📊"}</div>
        </div>
        <div class="kpi-val">${val}</div>
        <div class="kpi-sub">${sub}</div>
        <div class="kpi-spark" data-col="${kpi.column}" data-color="${kpi.color||"#22d3ee"}"></div>
        ${pct!==null?`<div class="kpi-prog"><div class="kpi-fill" style="width:0%" data-pct="${pct}"></div></div>`:""}
      `;
      grid.appendChild(card);
    });
    canvas.appendChild(grid);
  }

  // Insights
  if(spec.insights&&spec.insights.length){
    const row=el("div","insight-row fade-up d2");
    spec.insights.forEach(ins=>{
      const c=el("div","ichip"); c.innerHTML=`<span>💡</span>${ins}`; row.appendChild(c);
    });
    canvas.appendChild(row);
  }

  // Hero chart
  if(spec.charts&&spec.charts[0]){
    const sec=el("div","hero-section fade-up d2");
    sec.appendChild(makeChartCard(spec.charts[0],true));
    canvas.appendChild(sec);
  }

  // Sub-grid
  if(spec.charts&&spec.charts.length>1){
    const grid=el("div","sub-grid fade-up d3");
    spec.charts.slice(1).forEach(c=>grid.appendChild(makeChartCard(c,false)));
    canvas.appendChild(grid);
  }

  // Footer
  const foot=el("div","dash-footer");
  foot.textContent=`DashAI · ${new Date().toLocaleDateString()} · ${S.data.length.toLocaleString()} rows · ${spec.charts?.length||0} charts`;
  canvas.appendChild(foot);

  // Plot everything after DOM settles
  setTimeout(()=>{
    // Sparklines
    document.querySelectorAll(".kpi-spark[data-col]").forEach(sparkEl=>{
      plotSparkline(sparkEl,sparkEl.dataset.col,sparkEl.dataset.color);
    });
    // Progress fill animations
    document.querySelectorAll(".kpi-fill[data-pct]").forEach(fill=>{
      setTimeout(()=>fill.style.width=fill.dataset.pct+"%",200);
    });
    // Main charts
    (spec.charts||[]).forEach((c,i)=>{
      const div=document.getElementById("plt"+i);
      if(!div) return;
      try {
        const isAnim=c.animated&&["line","scatter"].includes(c.type)&&c.x;
        if(isAnim) plotAnimated(div,c);
        else Plotly.newPlot(div,buildTraces(c),buildLayout(c),{...PLOT_OPTS,toImageButtonOptions:{...PLOT_OPTS.toImageButtonOptions,filename:c.title||"chart"}});
      } catch(e){console.error("Plot error:",e,c);}
    });
  },160);
}

function makeChartCard(spec, isHero) {
  const idx=S.spec.charts.indexOf(spec);
  const card=el("div","chart-card");
  const hd=el("div","chart-hd");
  const title=el("span","chart-title"); title.textContent=spec.title||"";
  hd.appendChild(title);
  if(spec.animated){const t=el("span","anim-tag");t.textContent="▶ animated";hd.appendChild(t);}
  card.appendChild(hd);
  if(spec.insight){const s=el("div","chart-insight");s.textContent=spec.insight;card.appendChild(s);}
  const pDiv=document.createElement("div");
  pDiv.id="plt"+idx;
  pDiv.style.cssText=`width:100%;height:${isHero?"390px":"280px"}`;
  card.appendChild(pDiv);
  return card;
}

// ── Export HTML ───────────────────────────────────────────────
function doExportHTML() {
  if(!S.spec||!S.data) return;
  const chartsData=(S.spec.charts||[]).map((c,i)=>{
    try{return{i,traces:buildTraces(c),layout:buildLayout(c),title:c.title,insight:c.insight,isHero:i===0};}
    catch{return{i,traces:[],layout:{},title:c.title||"",insight:"",isHero:i===0};}
  });
  const kpiHTML=(S.spec.kpis||[]).map(kpi=>{
    const{val,sub}=computeKPI(kpi);
    return`<div style="background:#101827;border:1px solid #1a2540;border-radius:14px;padding:20px 22px;position:relative;overflow:hidden"><div style="position:absolute;top:0;left:0;right:0;height:3px;background:${kpi.color||"#22d3ee"}"></div><div style="font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#607090;margin-bottom:10px">${kpi.label}</div><div style="font-family:monospace;font-size:32px;color:#edf2f8;letter-spacing:-1px;line-height:1">${val}</div><div style="font-size:10px;color:#607090;margin-top:5px">${sub}</div></div>`;
  }).join("");
  const chartCards=chartsData.map(c=>{
    const h=c.isHero?400:290,mb=c.isHero?"margin-bottom:16px":"";
    return`<div style="background:#101827;border:1px solid #1a2540;border-radius:14px;padding:18px;overflow:hidden;${mb}"><div style="font-size:13px;font-weight:600;color:#edf2f8;margin-bottom:4px">${c.title||""}</div>${c.insight?`<div style="font-size:11px;color:#607090;margin-bottom:10px">${c.insight}</div>`:""}<div id="c${c.i}" style="height:${h}px"></div></div>`;
  });
  const plotJS=chartsData.map(c=>`try{Plotly.newPlot('c${c.i}',${JSON.stringify(c.traces)},Object.assign(${JSON.stringify(c.layout)},{autosize:true}),{responsive:true,displaylogo:false})}catch(e){}`).join("\n");
  const html=`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${S.spec.title||"Dashboard"}</title><script src="https://cdn.plot.ly/plotly-2.27.0.min.js"><\/script><link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#080d18;color:#edf2f8;font-family:'Sora',system-ui,sans-serif;padding:32px 28px}.wrap{max-width:1200px;margin:0 auto}.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:20px}.insight-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}.chip{background:#101827;border:1px solid #1a2540;border-radius:6px;padding:6px 12px;font-size:11.5px;color:#607090;line-height:1.4}.sub-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px;margin-bottom:16px}</style></head><body><div class="wrap"><div style="margin-bottom:22px"><h1 style="font-size:24px;font-weight:700;letter-spacing:-.5px;margin-bottom:6px">${S.spec.title||""}</h1><p style="font-size:13px;color:#607090;line-height:1.6">${S.spec.summary||""}</p></div><div class="kpi-grid">${kpiHTML}</div>${(S.spec.insights||[]).length?`<div class="insight-row">${(S.spec.insights||[]).map(i=>`<span class="chip">💡 ${i}</span>`).join("")}</div>`:""}<div>${chartCards[0]||""}</div><div class="sub-grid">${chartCards.slice(1).join("")}</div><div style="text-align:center;padding:24px 0 8px;font-size:10px;color:#1a2540">DashAI · ${new Date().toLocaleString()} · ${S.data.length.toLocaleString()} rows</div></div><script>${plotJS}<\/script></body></html>`;
  dlFile(html,"text/html",(S.spec.title||"dashboard").replace(/\W+/g,"_"),".html");
}

// ── Export PNG ────────────────────────────────────────────────
function doExportPNG() {
  const divs=document.querySelectorAll("[id^='plt']");
  if(!divs.length){alert("Generate a dashboard first.");return;}
  const base=(S.spec?.title||"chart").replace(/\W+/g,"_");
  divs.forEach((div,i)=>setTimeout(()=>{
    try{Plotly.downloadImage(div,{format:"png",scale:2,filename:`${base}_chart_${i+1}`,width:i===0?1400:900,height:i===0?660:480});}catch(e){}
  },i*750));
}

function dlFile(content,mime,name,ext){
  const b=new Blob([content],{type:mime}),u=URL.createObjectURL(b),a=document.createElement("a");
  a.href=u;a.download=name+ext;a.click();
  setTimeout(()=>URL.revokeObjectURL(u),1500);
}

// ── Nav helpers ───────────────────────────────────────────────
function goBack() {
  document.getElementById("page-dashboard").classList.remove("show");
  document.getElementById("page-upload").style.display="flex";
}
