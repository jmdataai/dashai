"""
DashAI Backend — FastAPI
Upload file → Profile → AI plan → Build Plotly figures server-side → Return complete figures.

All chart rendering happens here with pandas + Plotly. Frontend just renders.

GET/HEAD /health              → UptimeRobot keep-alive
POST     /api/upload          → Upload CSV/XLSX, returns dataset_id + profile
POST     /api/generate/{id}   → AI generates dashboard spec, builds Plotly figures
POST     /api/sample/{name}   → Load built-in demo dataset
"""
import io, json, os, re, uuid, random, logging
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, UploadFile, HTTPException, Response
from fastapi.responses import HTMLResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from figure_builder import build_chart, compute_kpi, format_kpi_value

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("dashai")

app = FastAPI(title="DashAI")

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

# ── In-memory dataset store (no DB needed) ─────────────────────
DATASETS: dict[str, dict[str, Any]] = {}
MAX = 64

def _store(did, df, profile):
    if len(DATASETS) >= MAX:
        oldest = min(DATASETS, key=lambda k: DATASETS[k]["ts"])
        DATASETS.pop(oldest, None)
    DATASETS[did] = {"df": df, "profile": profile, "ts": datetime.now(timezone.utc).isoformat()}

def _get(did):
    item = DATASETS.get(did)
    if not item: raise HTTPException(404, "Dataset expired. Please re-upload.")
    return item

# ── Data reading + profiling ───────────────────────────────────
def read_file(filename: str, raw: bytes) -> pd.DataFrame:
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "csv":
        return pd.read_csv(io.BytesIO(raw), low_memory=False)
    if ext in ("xlsx", "xls"):
        return pd.read_excel(io.BytesIO(raw))
    raise ValueError(f"Unsupported format: .{ext}")

def _semantic(series: pd.Series, name: str) -> str:
    """Classify column: numeric / datetime / categorical. Skip ID-like columns."""
    nm = name.lower().strip()
    # Detect IDs — never treat as useful numeric
    if nm.endswith("_id") or nm.startswith("id_") or nm == "id" or nm.endswith("id"):
        return "categorical"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    if pd.api.types.is_numeric_dtype(series):
        # If very high cardinality relative to rows and integer-like → probably ID
        if series.nunique() > 0.9 * len(series) and len(series) > 20:
            return "categorical"  # treat high-cardinality ints as categorical (IDs)
        return "numeric"
    # Try parsing as datetime
    if series.dtype == object:
        sample = series.dropna().head(30)
        try:
            parsed = pd.to_datetime(sample, errors="coerce")
            if parsed.notna().sum() >= len(sample) * 0.7:
                return "datetime"
        except: pass
    return "categorical"

def profile_df(df: pd.DataFrame, filename: str) -> dict:
    cols = []
    for c in df.columns:
        s = df[c]
        sem = _semantic(s, c)
        info = {"name": c, "dtype": str(s.dtype), "semantic": sem,
                "n_unique": int(s.nunique()), "n_null": int(s.isna().sum()),
                "sample_values": [str(v) for v in s.dropna().head(5).tolist()]}
        if sem == "numeric":
            ns = pd.to_numeric(s, errors="coerce").dropna()
            if len(ns):
                info.update({"min": float(ns.min()), "max": float(ns.max()),
                             "mean": float(ns.mean()), "sum": float(ns.sum())})
        cols.append(info)
    return {"filename": filename, "rows": len(df), "cols": len(df.columns),
            "columns": cols, "preview": df.head(5).fillna("").to_dict("records")}

# ── LLM cascade ───────────────────────────────────────────────
DEFAULT_GROQ_MODEL   = "llama-3.3-70b-versatile"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite"
PRIORITY = ["groq", "gemini", "openai", "anthropic"]

SYSTEM_PROMPT = """You are an elite data analyst and dashboard designer.
Given a dataset profile, design a premium analytics dashboard.
Output STRICT JSON only (no markdown, no commentary):
{
  "title": "Business dashboard title",
  "subtitle": "One-sentence summary with numbers",
  "kpis": [
    {"label": "SHORT LABEL", "metric": "sum|mean|max|min|count|count_distinct", "column": "col_name or null", "format": "number|currency|percent"}
  ],
  "charts": [
    {"id": "hero", "type": "bar|line|area|scatter|pie|donut|histogram|box|heatmap|treemap",
     "x": "col", "y": "col or null", "color": "col or null", "z": "col or null",
     "agg": "sum|mean|count|none",
     "title": "Business chart title", "subtitle": "Short caption",
     "span": 2}
  ]
}
Rules:
- 3-5 KPIs. NEVER use ID columns (anything ending in _id, version, etc.) as KPIs.
  Prefer revenue/sales → sum+currency, rates/scores → mean, counts → count.
- ONE hero chart (span=2), then 3-5 supporting charts (span=1).
- VARY chart types. datetime+numeric → line/area, category+numeric → bar, proportions → donut.
- Use ONLY column names from the schema. Column names are case-sensitive.
- KPI format: "currency" for money columns, "percent" for rates, "number" for everything else."""

def _build_user_prompt(profile: dict) -> str:
    lines = []
    for c in profile["columns"]:
        parts = [f"  {c['name']} ({c['semantic']}, dtype={c['dtype']}, unique={c['n_unique']})"]
        if c.get("min") is not None:
            parts.append(f"min={c['min']:.2f}, max={c['max']:.2f}, mean={c['mean']:.2f}")
        if c.get("sample_values"):
            sv = ", ".join(str(v)[:20] for v in c["sample_values"][:4])
            parts.append(f"samples=[{sv}]")
        lines.append(" | ".join(parts))
    return f"Dataset: {profile['filename']}\nRows: {profile['rows']}, Columns: {profile['cols']}\n\nSchema:\n" + "\n".join(lines) + "\n\nDesign the dashboard. JSON only."

def _call_groq(prompt: str) -> str:
    from openai import OpenAI
    c = OpenAI(api_key=os.environ["GROQ_API_KEY"], base_url="https://api.groq.com/openai/v1")
    r = c.chat.completions.create(
        model=os.environ.get("LLM_MODEL_GROQ", DEFAULT_GROQ_MODEL),
        messages=[{"role":"system","content":SYSTEM_PROMPT},{"role":"user","content":prompt}],
        temperature=0.7, max_tokens=1800, response_format={"type":"json_object"})
    return r.choices[0].message.content

def _call_gemini(prompt: str) -> str:
    from google import genai
    c = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
    r = c.models.generate_content(model=os.environ.get("LLM_MODEL_GEMINI", DEFAULT_GEMINI_MODEL),
        contents=SYSTEM_PROMPT + "\n\n" + prompt)
    return r.text

def _call_openai(prompt: str) -> str:
    from openai import OpenAI
    c = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    r = c.chat.completions.create(model=os.environ.get("LLM_MODEL_OPENAI","gpt-4o-mini"),
        messages=[{"role":"system","content":SYSTEM_PROMPT},{"role":"user","content":prompt}],
        temperature=0.7, max_tokens=1800)
    return r.choices[0].message.content

def _call_anthropic(prompt: str) -> str:
    import anthropic
    c = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    m = c.messages.create(model=os.environ.get("LLM_MODEL_ANTHROPIC","claude-haiku-4-5-20251001"),
        max_tokens=1800, system=SYSTEM_PROMPT,
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
        if not os.environ.get(key_var): continue
        try:
            raw = caller(prompt)
            text = raw.strip()
            if text.startswith("```"):
                lines = text.splitlines()
                text = "\n".join(lines[1:-1] if lines[-1].strip()=="```" else lines[1:])
            m = re.search(r"\{[\s\S]*\}", text)
            if not m: raise ValueError("No JSON")
            plan = json.loads(m.group(0))
            if plan.get("charts"):
                return plan, prov
        except Exception as e:
            logger.warning(f"[LLM] {prov} failed: {e}")
    return None, "none"

# ── Rule-based fallback ────────────────────────────────────────
def _fallback_plan(profile: dict, seed: int) -> dict:
    rng = random.Random(seed)
    cols = profile["columns"]
    num = [c for c in cols if c["semantic"]=="numeric"]
    cat = [c for c in cols if c["semantic"]=="categorical"]
    dt  = [c for c in cols if c["semantic"]=="datetime"]

    kpis = [{"label":"TOTAL RECORDS","metric":"count","column":None,"format":"number"}]
    for nc in num[:3]:
        m = rng.choice(["sum","mean","max"])
        fmt = "currency" if any(w in nc["name"].lower() for w in ["revenue","sales","amount","cost","price","profit"]) else "number"
        kpis.append({"label":f"{m.upper()} {nc['name'].upper().replace('_',' ')}","metric":m,"column":nc["name"],"format":fmt})
    if cat:
        kpis.append({"label":f"UNIQUE {cat[0]['name'].upper().replace('_',' ')}","metric":"count_distinct","column":cat[0]["name"],"format":"number"})

    charts = []
    if dt and num:
        charts.append({"id":"hero","type":"area","x":dt[0]["name"],"y":num[0]["name"],
                        "color":cat[0]["name"] if cat else None,"agg":"sum",
                        "title":f"{num[0]['name'].replace('_',' ').title()} Over Time","subtitle":"Trend across the full period","span":2})
    elif cat and num:
        charts.append({"id":"hero","type":"bar","x":cat[0]["name"],"y":num[0]["name"],"agg":"sum",
                        "title":f"{num[0]['name'].replace('_',' ').title()} by {cat[0]['name'].replace('_',' ').title()}","span":2})
    elif len(num) >= 2:
        charts.append({"id":"hero","type":"scatter","x":num[0]["name"],"y":num[1]["name"],
                        "color":cat[0]["name"] if cat else None, "agg":"none",
                        "title":f"{num[1]['name'].replace('_',' ').title()} vs {num[0]['name'].replace('_',' ').title()}","span":2})
    elif num:
        charts.append({"id":"hero","type":"histogram","x":num[0]["name"],"agg":"none",
                        "title":f"Distribution of {num[0]['name'].replace('_',' ').title()}","span":2})

    if cat and num and len(charts)<6:
        charts.append({"type":"donut","x":cat[0]["name"],"y":num[0]["name"],"agg":"sum",
                        "title":f"Share by {cat[0]['name'].replace('_',' ').title()}","span":1})
    if len(num)>=2 and len(charts)<6:
        charts.append({"type":"scatter","x":num[0]["name"],"y":num[1]["name"],
                        "color":cat[0]["name"] if cat else None,"agg":"none",
                        "title":f"{num[1]['name'].replace('_',' ').title()} vs {num[0]['name'].replace('_',' ').title()}","span":1})
    if num and len(charts)<6:
        charts.append({"type":"histogram","x":num[-1]["name"],"agg":"none",
                        "title":f"{num[-1]['name'].replace('_',' ').title()} Distribution","span":1})
    if len(cat)>=2 and num and len(charts)<6:
        charts.append({"type":"heatmap","x":cat[0]["name"],"y":cat[1]["name"],"z":num[0]["name"],"agg":"mean",
                        "title":f"{num[0]['name'].replace('_',' ').title()} Matrix","span":1})
    if num and cat and len(charts)<6:
        charts.append({"type":"box","x":cat[0]["name"],"y":num[0]["name"],"agg":"none",
                        "title":f"{num[0]['name'].replace('_',' ').title()} Range","span":1})

    fname = profile.get("filename","Dataset").rsplit(".",1)[0].replace("_"," ").title()
    return {"title":f"{fname} Insights","subtitle":f"{profile['rows']:,} records across {profile['cols']} dimensions",
            "kpis":kpis,"charts":charts}

# ── Sample dataset ─────────────────────────────────────────────
def _sample_sales() -> pd.DataFrame:
    rng = np.random.default_rng(7)
    months = pd.date_range("2024-01-01", periods=12, freq="MS")
    products, regions = ["Aurora","Blaze","Cipher","Drift"], ["NA","EU","APAC","LATAM"]
    rows = []
    for m in months:
        for p in products:
            for r in regions:
                base = {"Aurora":12000,"Blaze":8500,"Cipher":14000,"Drift":6500}[p]
                season = 1+0.3*np.sin((m.month-1)/12*2*np.pi)
                rmul = {"NA":1.4,"EU":1.1,"APAC":1.0,"LATAM":0.7}[r]
                rev = float(rng.normal(base, base*0.15)*season*rmul)
                rows.append({"date":m,"product":p,"region":r,"revenue":round(rev,2),
                             "units":int(max(1,rev/rng.uniform(120,200))),
                             "margin_pct":round(float(rng.uniform(8,28)),1)})
    return pd.DataFrame(rows)

# ════════════════════════════════════════════════════════════════
# ENDPOINTS
# ════════════════════════════════════════════════════════════════

@app.api_route("/health", methods=["GET","HEAD"])
def health(response: Response):
    providers = {p: bool(os.environ.get(kv)) for p,(_,kv) in _CALLERS.items()}
    return {"status":"ok","providers":providers}

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw: raise HTTPException(400, "Empty file")
    if len(raw) > 25*1024*1024: raise HTTPException(413, "Max 25 MB")
    try:
        df = read_file(file.filename or "data.csv", raw)
    except Exception as e:
        raise HTTPException(400, f"Cannot parse file: {e}")
    if df.empty: raise HTTPException(400, "File is empty")
    if len(df) > 50000: df = df.head(50000)
    profile = profile_df(df, file.filename or "data.csv")
    did = str(uuid.uuid4())
    _store(did, df, profile)
    return {"id": did, "filename": profile["filename"], "rows": profile["rows"],
            "cols": profile["cols"], "columns": profile["columns"],
            "preview": profile["preview"][:5]}

class GenReq(BaseModel):
    seed: int | None = None

@app.post("/api/generate/{dataset_id}")
async def generate(dataset_id: str, body: GenReq | None = None):
    item = _get(dataset_id)
    df, profile = item["df"], item["profile"]
    seed = (body.seed if body and body.seed else random.randint(0, 999999))
    prompt = _build_user_prompt(profile)

    plan, provider = _call_llm(prompt)
    if not plan:
        plan = _fallback_plan(profile, seed)
        provider = "rules"
    logger.info(f"Plan: provider={provider}, charts={len(plan.get('charts',[]))}")

    # Validate column refs
    valid_cols = set(c["name"] for c in profile["columns"])
    # Build KPIs
    kpis = []
    for k in (plan.get("kpis") or [])[:6]:
        if k.get("column") and k["column"] not in valid_cols: continue
        kpis.append(compute_kpi(k, df))
    if not kpis:
        kpis = [compute_kpi(k, df) for k in _fallback_plan(profile, seed)["kpis"]]

    # Build charts (server-side with Plotly)
    charts = []
    for i, spec in enumerate(plan.get("charts") or []):
        refs = [spec.get(k) for k in ("x","y","z","color") if spec.get(k)]
        if not all(r in valid_cols for r in refs): continue
        fig = build_chart(spec, df)
        if not fig: continue
        charts.append({
            "id": spec.get("id") or f"chart_{i}",
            "type": spec.get("type","bar"),
            "title": spec.get("title","Chart"),
            "subtitle": spec.get("subtitle"),
            "span": int(spec.get("span",1)),
            "figure": fig
        })

    if not charts:
        fb = _fallback_plan(profile, seed)
        for spec in fb["charts"]:
            fig = build_chart(spec, df)
            if fig:
                charts.append({"id":spec.get("id","c"),"type":spec.get("type","bar"),
                               "title":spec.get("title","Chart"),"subtitle":spec.get("subtitle"),
                               "span":int(spec.get("span",1)),"figure":fig})

    return {
        "dataset_id": dataset_id,
        "title": plan.get("title","Dashboard"),
        "subtitle": plan.get("subtitle",""),
        "kpis": kpis,
        "charts": charts,
        "provider": provider,
        "seed": seed,
    }

@app.post("/api/sample/{name}")
async def load_sample(name: str):
    if name != "sales": raise HTTPException(404, "Unknown sample")
    df = _sample_sales()
    profile = profile_df(df, "sales_sample.csv")
    did = str(uuid.uuid4())
    _store(did, df, profile)
    return {"id": did, "filename": profile["filename"], "rows": profile["rows"],
            "cols": profile["cols"], "columns": profile["columns"],
            "preview": profile["preview"][:5]}
