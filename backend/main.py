"""
DashAI Backend — FastAPI  v4
Fixes: single-date datetime detection, smarter column semantics,
       HTML export endpoint, GET/HEAD health for UptimeRobot.
"""
import io, json, os, re, uuid, random, logging, math
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, UploadFile, HTTPException, Response
from fastapi.responses import HTMLResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from figure_builder import build_chart, build_chart_with_fallback, compute_kpi, format_kpi_value, PALETTE

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("dashai")

app = FastAPI(title="DashAI")
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

# ── In-memory store ───────────────────────────────────────────
DATASETS: dict[str, dict[str, Any]] = {}

def _store(did, df, profile):
    if len(DATASETS) >= 64:
        oldest = min(DATASETS, key=lambda k: DATASETS[k]["ts"])
        DATASETS.pop(oldest, None)
    DATASETS[did] = {"df": df, "profile": profile, "ts": datetime.now(timezone.utc).isoformat()}

def _get(did):
    item = DATASETS.get(did)
    if not item:
        raise HTTPException(404, "Dataset expired — please re-upload.")
    return item

# ── File reading ──────────────────────────────────────────────
def read_file(filename: str, raw: bytes) -> pd.DataFrame:
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "csv":
        return pd.read_csv(io.BytesIO(raw), low_memory=False)
    if ext in ("xlsx", "xls"):
        return pd.read_excel(io.BytesIO(raw))
    raise ValueError(f"Unsupported: .{ext}")

# ── Semantic classification ───────────────────────────────────
_ID_PATTERNS = re.compile(r"(^id$|_id$|^id_|_key$|_hash$|_token$|_version$|_code$)", re.I)
_SKIP_COLS   = re.compile(r"(token|hash|base64|encoded|geolayer|prev_|next_|_slot$|_slots$)", re.I)

def _semantic(series: pd.Series, name: str) -> str:
    """numeric | datetime | categorical  — never IDs or junk columns."""
    if _ID_PATTERNS.search(name) or _SKIP_COLS.search(name):
        return "skip"
    if pd.api.types.is_datetime64_any_dtype(series):
        # Only useful as time-axis if there are ≥ 3 distinct dates
        if series.nunique() >= 3:
            return "datetime"
        return "categorical"
    if pd.api.types.is_bool_dtype(series):
        return "categorical"
    if pd.api.types.is_numeric_dtype(series):
        n_uniq = series.nunique()
        n_rows = len(series)
        # High-cardinality ints with values > 1000 are likely IDs
        if n_uniq > 0.85 * n_rows and n_rows > 20:
            return "skip"
        # Very small cardinality ints = categorical (e.g. arrival_hour → keep as numeric)
        if n_uniq <= 2:
            return "categorical"
        return "numeric"
    # String / object
    if series.dtype == object:
        sample = series.dropna().head(40)
        # Try datetime parse — use format="mixed" to avoid per-element parse warning
        try:
            parsed = pd.to_datetime(sample, errors="coerce", format="mixed")
            if parsed.notna().mean() >= 0.8:
                if series.nunique() >= 3:
                    return "datetime"
                return "categorical"
        except:
            pass
        # Skip if looks like JSON / base64
        if sample.str.startswith("{").mean() > 0.5 or sample.str.len().mean() > 80:
            return "skip"
        return "categorical"
    return "categorical"

def profile_df(df: pd.DataFrame, filename: str) -> dict:
    cols = []
    for c in df.columns:
        s   = df[c]
        sem = _semantic(s, c)
        if sem == "skip":
            continue
        info = {
            "name": c,
            "dtype": str(s.dtype),
            "semantic": sem,
            "n_unique": int(s.nunique()),
            "n_null": int(s.isna().sum()),
            "sample_values": [str(v) for v in s.dropna().head(6).tolist()],
        }
        if sem == "numeric":
            ns = pd.to_numeric(s, errors="coerce").dropna()
            if len(ns):
                info.update({
                    "min": float(ns.min()), "max": float(ns.max()),
                    "mean": float(ns.mean()), "sum": float(ns.sum()),
                })
        cols.append(info)
    return {
        "filename": filename,
        "rows": len(df),
        "cols": len(df.columns),
        "usable_cols": len(cols),
        "columns": cols,
        "preview": df.fillna("").astype(str).head(5).to_dict("records"),
    }

# ── LLM cascade ───────────────────────────────────────────────
DEFAULT_GROQ_MODEL   = "llama-3.3-70b-versatile"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite"
PRIORITY = ["groq", "gemini", "openai", "anthropic"]

SYSTEM_PROMPT = """You are an elite data analyst. Design a premium analytics dashboard.
Output STRICT JSON only — no markdown, no commentary.

{
  "title": "Specific dashboard title",
  "subtitle": "One-sentence summary with actual numbers from the data",
  "kpis": [
    {"label": "SHORT LABEL", "metric": "sum|mean|max|min|count|count_distinct",
     "column": "exact_col_name or null for row count",
     "format": "number|currency|percent"}
  ],
  "charts": [
    {"id": "hero", "type": "bar|line|area|scatter|pie|donut|histogram|box|heatmap|treemap|scatter3d|surface3d|animated_bar|animated_scatter",
     "x": "col or null", "y": "col or null",
     "color": "col or null", "z": "col or null",
     "agg": "sum|mean|count|none",
     "animation_frame": "col or null",
     "title": "Chart title", "subtitle": "Caption",
     "span": 2}
  ]
}

Rules:
- 3-5 KPIs. NEVER use ID/skip/token/hash columns. Prefer numeric columns with business meaning.
- ONE hero chart (id="hero", span=2). Then 3-5 supporting charts (span=1). Max 6 charts total.
- VARY chart types. If datetime col has many unique dates → line/area. Category+numeric → bar.
  Proportions → donut. Distributions → histogram/box. Two categories → heatmap.
- 3D CHARTS (use sparingly — only when it adds value):
  scatter3d: ONLY when 3+ numeric columns exist. Set x, y, z to three different numeric cols. color can be a categorical col.
  surface3d: ONLY when 2 categorical + 1 numeric exist. x=cat1, y=cat2, z=numeric. Shows a 3D surface of aggregated values.
- ANIMATED CHARTS (use ONE at most — only when a clear ordering column exists):
  animated_bar: Set animation_frame to a categorical/datetime col with 3-20 unique values. Shows how bar values change across frames.
  animated_scatter: Set animation_frame same way. Shows dots moving across frames.
- Only use columns listed in the schema — exact names, case-sensitive.
- KPI format: "currency" for money/revenue, "percent" for rates, "number" otherwise.
- Do NOT force 3D or animation. Use them ONLY when data clearly supports it."""

def _build_prompt(profile: dict) -> str:
    lines = []
    for c in profile["columns"]:
        p = [f"  {c['name']} ({c['semantic']}, unique={c['n_unique']})"]
        if c.get("min") is not None:
            p.append(f"min={c['min']:.1f}, max={c['max']:.1f}, mean={c['mean']:.1f}")
        sv = ", ".join(str(v)[:20] for v in c["sample_values"][:4])
        p.append(f"samples=[{sv}]")
        lines.append(" | ".join(p))
    return (f"File: {profile['filename']}\n"
            f"Rows: {profile['rows']}, Usable columns: {profile['usable_cols']}\n\n"
            f"Schema:\n" + "\n".join(lines) +
            "\n\nDesign the dashboard. JSON only.")

def _call_groq(prompt):
    from openai import OpenAI
    c = OpenAI(api_key=os.environ["GROQ_API_KEY"], base_url="https://api.groq.com/openai/v1")
    r = c.chat.completions.create(
        model=os.environ.get("LLM_MODEL_GROQ", DEFAULT_GROQ_MODEL),
        messages=[{"role":"system","content":SYSTEM_PROMPT},{"role":"user","content":prompt}],
        temperature=0.7, max_tokens=2000, response_format={"type":"json_object"})
    return r.choices[0].message.content

def _call_gemini(prompt):
    from google import genai
    c = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
    r = c.models.generate_content(
        model=os.environ.get("LLM_MODEL_GEMINI", DEFAULT_GEMINI_MODEL),
        contents=SYSTEM_PROMPT + "\n\n" + prompt)
    return r.text

def _call_openai(prompt):
    from openai import OpenAI
    c = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    r = c.chat.completions.create(
        model=os.environ.get("LLM_MODEL_OPENAI","gpt-4o-mini"),
        messages=[{"role":"system","content":SYSTEM_PROMPT},{"role":"user","content":prompt}],
        temperature=0.7, max_tokens=2000)
    return r.choices[0].message.content

def _call_anthropic(prompt):
    import anthropic
    c = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    m = c.messages.create(model=os.environ.get("LLM_MODEL_ANTHROPIC","claude-haiku-4-5-20251001"),
        max_tokens=2000, system=SYSTEM_PROMPT,
        messages=[{"role":"user","content":prompt}])
    return m.content[0].text

_CALLERS = {
    "groq":      (_call_groq,      "GROQ_API_KEY"),
    "gemini":    (_call_gemini,    "GOOGLE_API_KEY"),
    "openai":    (_call_openai,    "OPENAI_API_KEY"),
    "anthropic": (_call_anthropic, "ANTHROPIC_API_KEY"),
}

def _call_llm(prompt: str) -> tuple[dict, str]:
    configured = os.environ.get("LLM_PROVIDER", "groq").lower().strip()
    ordered = [configured] + [p for p in PRIORITY if p != configured]
    for prov in ordered:
        caller, key_var = _CALLERS[prov]
        if not os.environ.get(key_var):
            continue
        try:
            raw = caller(prompt).strip()
            if raw.startswith("```"):
                lines = raw.splitlines()
                raw = "\n".join(lines[1:-1] if lines[-1].strip()=="```" else lines[1:])
            m = re.search(r"\{[\s\S]*\}", raw)
            if not m:
                raise ValueError("No JSON found")
            plan = json.loads(m.group(0))
            if plan.get("charts"):
                return plan, prov
        except Exception as e:
            logger.warning(f"[LLM] {prov} failed: {e}")
    return None, "none"

# ── Rule-based fallback ────────────────────────────────────────
def _fallback_plan(profile: dict, seed: int) -> dict:
    rng  = random.Random(seed)
    cols = profile["columns"]
    num  = [c for c in cols if c["semantic"] == "numeric"]
    cat  = [c for c in cols if c["semantic"] == "categorical"]
    dt   = [c for c in cols if c["semantic"] == "datetime"]

    kpis = [{"label":"TOTAL RECORDS","metric":"count","column":None,"format":"number"}]
    for nc in num[:3]:
        m   = rng.choice(["sum","mean","max"])
        fmt = "currency" if any(w in nc["name"].lower() for w in ["revenue","sales","amount","cost","price","profit"]) else "number"
        kpis.append({"label": nc["name"].upper().replace("_"," "), "metric": m,
                     "column": nc["name"], "format": fmt})
    if cat:
        kpis.append({"label": f"UNIQUE {cat[0]['name'].upper().replace('_',' ')}",
                     "metric": "count_distinct", "column": cat[0]["name"], "format": "number"})

    charts = []
    if dt and num:
        charts.append({"id":"hero","type":"area","x":dt[0]["name"],"y":num[0]["name"],
                        "color":cat[0]["name"] if cat else None,"agg":"sum","span":2,
                        "title":f"{num[0]['name'].replace('_',' ').title()} Over Time",
                        "subtitle":"Trend across the full date range"})
    elif cat and num:
        charts.append({"id":"hero","type":"bar","x":cat[0]["name"],"y":num[0]["name"],
                        "agg":"mean","span":2,
                        "title":f"{num[0]['name'].replace('_',' ').title()} by {cat[0]['name'].replace('_',' ').title()}",
                        "subtitle":"Average by category"})
    elif len(num) >= 2:
        charts.append({"id":"hero","type":"scatter","x":num[0]["name"],"y":num[1]["name"],
                        "color":cat[0]["name"] if cat else None,"agg":"none","span":2,
                        "title":f"{num[1]['name'].replace('_',' ').title()} vs {num[0]['name'].replace('_',' ').title()}",
                        "subtitle":"Relationship between two key metrics"})
    elif num:
        charts.append({"id":"hero","type":"histogram","x":num[0]["name"],"span":2,
                        "title":f"Distribution of {num[0]['name'].replace('_',' ').title()}",
                        "subtitle":"Frequency distribution"})

    if cat and num and len(charts) < 6:
        charts.append({"type":"donut","x":cat[0]["name"],"y":num[0]["name"],"agg":"sum","span":1,
                        "title":f"Share by {cat[0]['name'].replace('_',' ').title()}"})
    if len(cat) >= 2 and num and len(charts) < 6:
        charts.append({"type":"bar","x":cat[1]["name"],"y":num[0]["name"],"agg":"mean","span":1,
                        "title":f"{num[0]['name'].replace('_',' ').title()} by {cat[1]['name'].replace('_',' ').title()}"})
    if num and len(charts) < 6:
        charts.append({"type":"histogram","x":num[-1]["name"],"agg":"none","span":1,
                        "title":f"{num[-1]['name'].replace('_',' ').title()} Distribution"})
    if len(cat) >= 2 and num and len(charts) < 6:
        charts.append({"type":"heatmap","x":cat[0]["name"],"y":cat[1]["name"],"z":num[0]["name"],"agg":"mean","span":1,
                        "title":f"{num[0]['name'].replace('_',' ').title()} Matrix"})

    # 3D scatter when 3+ numeric columns exist
    if len(num) >= 3 and len(charts) < 7:
        charts.append({"type":"scatter3d","x":num[0]["name"],"y":num[1]["name"],"z":num[2]["name"],
                        "color":cat[0]["name"] if cat else None,"agg":"none","span":1,
                        "title":f"3D: {num[0]['name'].replace('_',' ')} × {num[1]['name'].replace('_',' ')} × {num[2]['name'].replace('_',' ')}",
                        "subtitle":"Interactive — drag to rotate"})

    # 3D surface when 2 categoricals + numeric
    if len(cat) >= 2 and num and len(charts) < 7:
        charts.append({"type":"surface3d","x":cat[0]["name"],"y":cat[1]["name"],"z":num[0]["name"],"agg":"mean","span":1,
                        "title":f"3D Surface: {num[0]['name'].replace('_',' ').title()}",
                        "subtitle":"Mean values across two dimensions"})

    # Animated bar when there's a categorical with 3-15 values to animate over
    anim_col = next((c for c in cat if 3 <= c["n_unique"] <= 15 and c["name"] != (cat[0]["name"] if cat else "")), None)
    if anim_col and cat and num and len(charts) < 7:
        charts.append({"type":"animated_bar","x":cat[0]["name"],"y":num[0]["name"],
                        "animation_frame":anim_col["name"],"agg":"mean","span":2,
                        "title":f"{num[0]['name'].replace('_',' ').title()} — Animated by {anim_col['name'].replace('_',' ').title()}",
                        "subtitle":"Press ▶ to play the animation"})

    fname = profile.get("filename","Dataset").rsplit(".",1)[0].replace("_"," ").title()
    return {
        "title": f"{fname} Insights",
        "subtitle": f"{profile['rows']:,} records across {profile['usable_cols']} dimensions",
        "kpis": kpis,
        "charts": charts,
    }

# ── Sample data ───────────────────────────────────────────────
def _sample_sales() -> pd.DataFrame:
    rng = np.random.default_rng(7)
    months = pd.date_range("2024-01-01", periods=12, freq="MS")
    products, regions = ["Aurora","Blaze","Cipher","Drift"], ["NA","EU","APAC","LATAM"]
    rows = []
    for m in months:
        for p in products:
            for r in regions:
                base = {"Aurora":12000,"Blaze":8500,"Cipher":14000,"Drift":6500}[p]
                season = 1 + 0.3 * np.sin((m.month - 1) / 12 * 2 * np.pi)
                rmul   = {"NA":1.4,"EU":1.1,"APAC":1.0,"LATAM":0.7}[r]
                rev    = float(rng.normal(base, base*0.15) * season * rmul)
                rows.append({"date":m,"product":p,"region":r,"revenue":round(rev,2),
                             "units":int(max(1,rev/rng.uniform(120,200))),
                             "margin_pct":round(float(rng.uniform(8,28)),1)})
    return pd.DataFrame(rows)

# ── HTML export builder ────────────────────────────────────────
def build_export_html(dashboard: dict) -> str:
    """Build a standalone, fully interactive HTML dashboard."""
    kpi_html = ""
    colors = ["#22d3ee","#a78bfa","#10b981","#f59e0b","#5b6ef5","#f87171"]
    icons  = ["💰","📈","🎯","📦","⚡","🔢"]
    for i, k in enumerate(dashboard.get("kpis", [])):
        val    = k.get("formatted_value") or format_kpi_value(k.get("value", 0), k.get("format","number"))
        color  = colors[i % len(colors)]
        icon   = icons[i % len(icons)]
        sub    = (k.get("column") or "total") + " · " + k.get("metric","count")
        kpi_html += f"""
        <div class="kpi-card" style="--kc:{color}">
          <div class="kpi-top">
            <div class="kpi-lbl">{k.get('label','KPI')}</div>
            <div class="kpi-ico">{icon}</div>
          </div>
          <div class="kpi-val">{val}</div>
          <div class="kpi-sub">{sub}</div>
        </div>"""

    charts     = dashboard.get("charts", [])
    hero       = next((c for c in charts if c.get("span",1) >= 2), charts[0] if charts else None)
    subs       = [c for c in charts if c is not hero]
    chart_data = json.dumps({f"fig_{c['id']}": c["figure"] for c in charts if c.get("figure")})

    hero_html = ""
    if hero and hero.get("figure"):
        hero_html = f"""
        <div class="chart-card hero-card">
          <div class="chart-hd">
            <span class="chart-title">{hero.get('title','')}</span>
          </div>
          {f'<div class="chart-sub">{hero["subtitle"]}</div>' if hero.get("subtitle") else ""}
          <div id="fig_{hero['id']}" class="chart-div hero-div"></div>
        </div>"""

    subs_html = ""
    for c in subs:
        if not c.get("figure"):
            continue
        subs_html += f"""
        <div class="chart-card">
          <div class="chart-hd">
            <span class="chart-title">{c.get('title','')}</span>
          </div>
          {f'<div class="chart-sub">{c["subtitle"]}</div>' if c.get("subtitle") else ""}
          <div id="fig_{c['id']}" class="chart-div sub-div"></div>
        </div>"""

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{dashboard.get('title','Dashboard')}</title>
<script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#080d18;color:#edf2f8;font-family:'Sora',system-ui,sans-serif;padding:32px 28px;min-height:100vh}}
.wrap{{max-width:1240px;margin:0 auto}}
h1{{font-size:clamp(20px,3vw,28px);font-weight:800;letter-spacing:-.5px;margin-bottom:6px}}
.sub{{font-size:13px;color:#607090;margin-bottom:24px;line-height:1.6}}
.kpi-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:22px}}
.kpi-card{{background:#101827;border:1px solid #1a2540;border-radius:14px;padding:20px 22px 16px;position:relative;overflow:hidden;transition:border-color .2s,transform .2s}}
.kpi-card:hover{{border-color:#203050;transform:translateY(-2px)}}
.kpi-card::before{{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--kc,#22d3ee);border-radius:14px 14px 0 0}}
.kpi-top{{display:flex;justify-content:space-between;margin-bottom:10px}}
.kpi-lbl{{font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#607090}}
.kpi-ico{{font-size:17px;opacity:.45}}
.kpi-val{{font-family:'JetBrains Mono',monospace;font-size:32px;font-weight:500;letter-spacing:-1.5px;line-height:1;margin-bottom:5px}}
.kpi-sub{{font-size:10px;color:#344560}}
.chart-card{{background:#101827;border:1px solid #1a2540;border-radius:14px;padding:18px 18px 8px;overflow:hidden;transition:border-color .25s,box-shadow .25s,transform .25s;cursor:default}}
.chart-card:hover{{border-color:#5b6ef5;box-shadow:0 0 24px rgba(91,110,245,.15);transform:translateY(-3px)}}
.hero-card{{margin-bottom:16px}}
.chart-hd{{display:flex;align-items:center;gap:8px;margin-bottom:3px}}
.chart-title{{font-size:13px;font-weight:600}}
.chart-sub{{font-size:11px;color:#607090;margin-bottom:10px}}
.chart-div{{width:100%}}
.hero-div{{height:400px}}
.sub-div{{height:300px}}
.sub-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px;margin-bottom:16px}}
footer{{text-align:center;padding:28px 0 8px;font-size:10px;color:#1a2540}}
::-webkit-scrollbar{{width:5px}}::-webkit-scrollbar-thumb{{background:#1a2540;border-radius:3px}}
</style>
</head>
<body>
<div class="wrap">
  <h1>{dashboard.get('title','Dashboard')}</h1>
  <div class="sub">{dashboard.get('subtitle','')}</div>
  <div class="kpi-grid">{kpi_html}</div>
  {hero_html}
  <div class="sub-grid">{subs_html}</div>
  <footer>Generated by DashAI · {ts}</footer>
</div>
<script>
const FIGS = {chart_data};
const BASE_LAYOUT = {{
  paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)",
  font:{{color:"#607090",family:"Sora,sans-serif",size:11}},
  xaxis:{{gridcolor:"rgba(255,255,255,0.05)",linecolor:"rgba(255,255,255,0.08)",tickfont:{{color:"#344560",size:10}},zeroline:false}},
  yaxis:{{gridcolor:"rgba(255,255,255,0.05)",linecolor:"rgba(255,255,255,0.08)",tickfont:{{color:"#344560",size:10}},zeroline:false}},
  hoverlabel:{{bgcolor:"#141e2e",bordercolor:"#203050",font:{{color:"#edf2f8",size:12}}}},
  margin:{{t:8,r:18,b:46,l:52}}, autosize:true
}};
Object.entries(FIGS).forEach(([id, fig])=>{{
  const el = document.getElementById(id);
  if(!el || !fig) return;
  const layout = Object.assign({{}}, BASE_LAYOUT, fig.layout || {{}}, {{autosize:true}});
  // Handle 3D scene backgrounds
  const is3D = (fig.data||[]).some(t=>["scatter3d","surface","mesh3d"].includes(t.type));
  if(is3D){{
    const sa={{backgroundcolor:"rgba(6,10,20,0.95)",gridcolor:"rgba(255,255,255,0.06)",color:"#607090",showbackground:true}};
    layout.scene=Object.assign({{}},layout.scene||{{}},{{bgcolor:"rgba(6,10,20,0.95)",xaxis:sa,yaxis:sa,zaxis:sa}});
    el.style.height="480px";
  }}
  // Handle animation frames
  if(fig.frames&&fig.frames.length){{
    layout.margin=Object.assign({{}},layout.margin,{{b:80}});
    el.style.height="480px";
    Plotly.newPlot(el,fig.data||[],layout,{{responsive:true,displayModeBar:true,displaylogo:false}}).then(()=>{{
      Plotly.addFrames(el,fig.frames);
    }});
  }}else{{
    Plotly.newPlot(el,fig.data||[],layout,{{responsive:true,displayModeBar:true,displaylogo:false}});
  }}
}});
</script>
</body>
</html>"""

# ════════════════════════════════════════════════════════════════
# ENDPOINTS
# ════════════════════════════════════════════════════════════════

@app.api_route("/health", methods=["GET", "HEAD"])
def health(response: Response):
    providers = {p: bool(os.environ.get(kv)) for p, (_, kv) in _CALLERS.items()}
    return {"status": "ok", "providers": providers}

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:          raise HTTPException(400, "Empty file")
    if len(raw) > 25_000_000: raise HTTPException(413, "Max 25 MB")
    try:
        df = read_file(file.filename or "data.csv", raw)
    except Exception as e:
        raise HTTPException(400, f"Cannot parse: {e}")
    if df.empty: raise HTTPException(400, "File is empty")
    if len(df) > 50000: df = df.head(50000)
    profile = profile_df(df, file.filename or "data.csv")
    did = str(uuid.uuid4())
    _store(did, df, profile)
    return {"id": did, "filename": profile["filename"], "rows": profile["rows"],
            "cols": profile["cols"], "usable_cols": profile["usable_cols"],
            "columns": profile["columns"], "preview": profile["preview"]}

class GenReq(BaseModel):
    seed: int | None = None

@app.post("/api/generate/{dataset_id}")
async def generate(dataset_id: str, body: GenReq | None = None):
    item   = _get(dataset_id)
    df, profile = item["df"], item["profile"]
    seed   = (body.seed if body and body.seed else random.randint(0, 999999))
    plan, provider = _call_llm(_build_prompt(profile))
    if not plan:
        plan     = _fallback_plan(profile, seed)
        provider = "rules"
    logger.info(f"provider={provider} charts={len(plan.get('charts',[]))}")

    valid_cols = {c["name"] for c in profile["columns"]}

    # KPIs
    kpis = []
    for k in (plan.get("kpis") or [])[:6]:
        if k.get("column") and k["column"] not in valid_cols:
            continue
        kpi = compute_kpi(k, df)
        kpi["formatted_value"] = format_kpi_value(kpi["value"], kpi["format"])
        kpis.append(kpi)
    if not kpis:
        for k in _fallback_plan(profile, seed)["kpis"]:
            kpi = compute_kpi(k, df)
            kpi["formatted_value"] = format_kpi_value(kpi["value"], kpi["format"])
            kpis.append(kpi)

    # Charts — use fallback chain so every slot is filled
    charts = []
    for i, spec in enumerate(plan.get("charts") or []):
        refs = [spec.get(k) for k in ("x","y","z","color","animation_frame") if spec.get(k)]
        if not all(r in valid_cols for r in refs):
            logger.warning(f"Skipping chart '{spec.get('type')}' — bad cols {refs}")
            continue
        fig, actual_type = build_chart_with_fallback(spec, df)
        if not fig:
            continue          # all fallbacks exhausted — truly nothing to show
        charts.append({
            "id":       spec.get("id") or f"c{i}",
            "type":     actual_type,              # actual type rendered (may be fallback)
            "title":    spec.get("title","Chart"),
            "subtitle": spec.get("subtitle"),
            "span":     int(spec.get("span",1)),
            "figure":   fig,
        })

    if not charts:
        fb = _fallback_plan(profile, seed)
        for spec in fb["charts"]:
            fig, actual_type = build_chart_with_fallback(spec, df)
            if fig:
                charts.append({"id":spec.get("id","c"),"type":actual_type,
                               "title":spec.get("title","Chart"),"subtitle":spec.get("subtitle"),
                               "span":int(spec.get("span",1)),"figure":fig})

    dashboard = {
        "dataset_id": dataset_id,
        "title":      plan.get("title","Dashboard"),
        "subtitle":   plan.get("subtitle",""),
        "kpis":       kpis,
        "charts":     charts,
        "provider":   provider,
        "seed":       seed,
    }
    return dashboard

class ExportReq(BaseModel):
    dashboard: dict

@app.post("/api/export/html")
async def export_html(req: ExportReq):
    html = build_export_html(req.dashboard)
    title = req.dashboard.get("title","dashboard").replace(" ","_")
    return HTMLResponse(
        content=html,
        headers={"Content-Disposition": f'attachment; filename="{title}.html"'},
    )

@app.post("/api/sample/{name}")
async def sample(name: str):
    if name != "sales": raise HTTPException(404, "Unknown sample")
    df      = _sample_sales()
    profile = profile_df(df, "sales_sample.csv")
    did     = str(uuid.uuid4())
    _store(did, df, profile)
    return {"id": did, "filename": profile["filename"], "rows": profile["rows"],
            "cols": profile["cols"], "usable_cols": profile["usable_cols"],
            "columns": profile["columns"], "preview": profile["preview"]}
