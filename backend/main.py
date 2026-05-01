"""
JMData Talent Dash Backend — FastAPI v6
Enterprise redesign: insights, real KPI trends, chart update, AI chat.
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

app = FastAPI(title="JMData Talent Dash")
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

DATASETS: dict[str, dict[str, Any]] = {}

def _store(did, df, profile):
    if len(DATASETS) >= 64:
        oldest = min(DATASETS, key=lambda k: DATASETS[k]["ts"])
        DATASETS.pop(oldest, None)
    DATASETS[did] = {"df": df, "profile": profile, "plan": None, "ts": datetime.now(timezone.utc).isoformat()}

def _get(did):
    item = DATASETS.get(did)
    if not item:
        raise HTTPException(404, "Dataset expired — please re-upload.")
    return item

def read_file(filename: str, raw: bytes) -> pd.DataFrame:
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "csv":
        return pd.read_csv(io.BytesIO(raw), low_memory=False)
    if ext in ("xlsx", "xls"):
        return pd.read_excel(io.BytesIO(raw))
    raise ValueError(f"Unsupported: .{ext}")

_ID_PATTERNS = re.compile(r"(^id$|_id$|^id_|_key$|_hash$|_token$|_version$|_code$)", re.I)
_SKIP_COLS   = re.compile(r"(token|hash|base64|encoded|geolayer|prev_|next_|_slot$|_slots$)", re.I)

def _semantic(series: pd.Series, name: str) -> str:
    if _ID_PATTERNS.search(name) or _SKIP_COLS.search(name):
        return "skip"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime" if series.nunique() >= 3 else "categorical"
    if pd.api.types.is_bool_dtype(series):
        return "categorical"
    if pd.api.types.is_numeric_dtype(series):
        n_uniq = series.nunique()
        n_rows = len(series)
        if n_uniq > 0.85 * n_rows and n_rows > 20:
            return "skip"
        if n_uniq <= 2:
            return "categorical"
        return "numeric"
    if series.dtype == object:
        sample = series.dropna().head(40)
        try:
            parsed = pd.to_datetime(sample, errors="coerce", format="mixed")
            if parsed.notna().mean() >= 0.8:
                return "datetime" if series.nunique() >= 3 else "categorical"
        except:
            pass
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
            "name": c, "dtype": str(s.dtype), "semantic": sem,
            "n_unique": int(s.nunique()), "n_null": int(s.isna().sum()),
            "sample_values": [str(v) for v in s.dropna().head(6).tolist()],
        }
        if sem == "numeric":
            ns = pd.to_numeric(s, errors="coerce").dropna()
            if len(ns):
                info.update({"min": float(ns.min()), "max": float(ns.max()),
                             "mean": float(ns.mean()), "sum": float(ns.sum())})
        cols.append(info)
    return {
        "filename": filename, "rows": len(df), "cols": len(df.columns),
        "usable_cols": len(cols), "columns": cols,
        "preview": df.fillna("").astype(str).head(50).to_dict("records"),
    }

DEFAULT_GROQ_MODEL   = "llama-3.3-70b-versatile"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite"
PRIORITY = ["groq", "gemini", "openai", "anthropic"]

SYSTEM_PROMPT = """You are an elite data analyst. Design a premium analytics dashboard.
Output STRICT JSON only — no markdown, no commentary.

{
  "title": "Specific dashboard title",
  "subtitle": "One-sentence summary with actual numbers from the data",
  "insights": ["Specific finding with actual numbers", "Another data-driven finding"],
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
- 3-5 KPIs. NEVER use ID/skip/token/hash columns.
- ONE hero chart (id="hero", span=2). Then 3-5 supporting charts (span=1). Max 6 charts total.
- 3-5 insight bullets referencing actual column names and computed values. Be specific and quantitative.
- VARY chart types. datetime col -> line/area. Category+numeric -> bar. Proportions -> donut.
- scatter3d: ONLY when 3+ numeric columns exist.
- surface3d: ONLY when 2 categorical + 1 numeric exist.
- animated_bar/animated_scatter: animation_frame col with 3-20 unique values. ONE at most.
- Only use columns listed in the schema — exact names, case-sensitive.
- KPI format: "currency" for money/revenue, "percent" for rates, "number" otherwise."""

CHAT_SYSTEM_PROMPT = """You are an AI analytics assistant inside a data dashboard.
Reply conversationally (2-3 sentences), then optionally include ONE action block:
<action>{"type":"update_chart","chart_id":"id","spec":{"type":"line","x":"col","y":"col","color":null,"agg":"sum","title":"Title"}}</action>
OR: <action>{"type":"add_chart","spec":{"type":"bar","x":"col","y":"col","color":null,"agg":"sum","title":"Title","span":1}}</action>

Rules:
- ONLY use column names that appear EXACTLY in the schema below. Never invent or guess column names.
- If the user asks for a column that is not in the schema, DO NOT produce an action block. Instead reply asking them to choose from the available columns and list them.
- If the user's request is ambiguous (e.g. "change the chart" without specifying which one), ask which chart they mean and list the available chart IDs.
- For analysis/insight questions: text reply only, no action block.
- Use exact chart IDs from the current charts list when updating."""

def _build_prompt(profile: dict) -> str:
    lines = []
    for c in profile["columns"]:
        p = [f"  {c['name']} ({c['semantic']}, unique={c['n_unique']})"]
        if c.get("min") is not None:
            p.append(f"min={c['min']:.1f}, max={c['max']:.1f}, mean={c['mean']:.1f}")
        sv = ", ".join(str(v)[:20] for v in c["sample_values"][:4])
        p.append(f"samples=[{sv}]")
        lines.append(" | ".join(p))
    return (f"File: {profile['filename']}\nRows: {profile['rows']}, Usable columns: {profile['usable_cols']}\n\n"
            f"Schema:\n" + "\n".join(lines) + "\n\nDesign the dashboard. JSON only.")

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
    r = c.models.generate_content(model=os.environ.get("LLM_MODEL_GEMINI", DEFAULT_GEMINI_MODEL),
        contents=SYSTEM_PROMPT + "\n\n" + prompt)
    return r.text

def _call_openai(prompt):
    from openai import OpenAI
    c = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    r = c.chat.completions.create(model=os.environ.get("LLM_MODEL_OPENAI","gpt-4o-mini"),
        messages=[{"role":"system","content":SYSTEM_PROMPT},{"role":"user","content":prompt}],
        temperature=0.7, max_tokens=2000)
    return r.choices[0].message.content

def _call_anthropic(prompt):
    import anthropic
    c = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    m = c.messages.create(model=os.environ.get("LLM_MODEL_ANTHROPIC","claude-haiku-4-5-20251001"),
        max_tokens=2000, system=SYSTEM_PROMPT, messages=[{"role":"user","content":prompt}])
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
            if not m: raise ValueError("No JSON found")
            plan = json.loads(m.group(0))
            if plan.get("charts"): return plan, prov
        except Exception as e:
            logger.warning(f"[LLM] {prov} failed: {e}")
    return None, "none"

def _call_llm_chat(messages: list) -> str:
    configured = os.environ.get("LLM_PROVIDER", "groq").lower().strip()
    ordered = [configured] + [p for p in PRIORITY if p != configured]
    for prov in ordered:
        _, key_var = _CALLERS[prov]
        if not os.environ.get(key_var):
            continue
        try:
            if prov == "groq":
                from openai import OpenAI
                c = OpenAI(api_key=os.environ["GROQ_API_KEY"], base_url="https://api.groq.com/openai/v1")
                r = c.chat.completions.create(model=os.environ.get("LLM_MODEL_GROQ", DEFAULT_GROQ_MODEL),
                    messages=messages, temperature=0.7, max_tokens=600)
                return r.choices[0].message.content
            elif prov == "gemini":
                from google import genai
                c = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
                full = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in messages)
                r = c.models.generate_content(model=os.environ.get("LLM_MODEL_GEMINI", DEFAULT_GEMINI_MODEL), contents=full)
                return r.text
            elif prov == "openai":
                from openai import OpenAI
                c = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
                r = c.chat.completions.create(model=os.environ.get("LLM_MODEL_OPENAI","gpt-4o-mini"),
                    messages=messages, temperature=0.7, max_tokens=600)
                return r.choices[0].message.content
            elif prov == "anthropic":
                import anthropic
                sys_msg = next((m["content"] for m in messages if m["role"]=="system"), "")
                chat_msgs = [m for m in messages if m["role"]!="system"]
                c = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
                m = c.messages.create(model=os.environ.get("LLM_MODEL_ANTHROPIC","claude-haiku-4-5-20251001"),
                    max_tokens=600, system=sys_msg, messages=chat_msgs)
                return m.content[0].text
        except Exception as e:
            logger.warning(f"[CHAT LLM] {prov} failed: {e}")
    return "I'm having trouble connecting to the AI engine right now. Please try again."

def _compute_trend(df: pd.DataFrame, col: str, metric: str):
    dt_cols = [c for c in df.columns if pd.api.types.is_datetime64_any_dtype(df[c])
               or (df[c].dtype == object and pd.to_datetime(df[c], errors="coerce", format="mixed").notna().mean() > 0.7)]
    if not dt_cols or not col or col not in df.columns:
        return None
    try:
        sdf = df.sort_values(dt_cols[0])
        mid = len(sdf) // 2
        fn = {"sum":"sum","mean":"mean","max":"max","min":"min","count":"count"}.get(metric,"sum")
        v1 = getattr(pd.to_numeric(sdf.iloc[:mid][col], errors="coerce"), fn)()
        v2 = getattr(pd.to_numeric(sdf.iloc[mid:][col], errors="coerce"), fn)()
        if v1 and v1 != 0:
            return round((v2 - v1) / abs(v1) * 100, 1)
    except:
        pass
    return None

def _fallback_insights(profile: dict, kpis: list) -> list[str]:
    insights = [f"Dataset contains {profile['rows']:,} rows across {profile['usable_cols']} usable dimensions."]
    for k in kpis[:2]:
        if k.get("column") and k.get("formatted_value"):
            insights.append(f"{k['label']}: {k['formatted_value']} ({k.get('metric','count')} of {k['column']})")
    num_cols = [c for c in profile["columns"] if c["semantic"] == "numeric"]
    if num_cols:
        nc = num_cols[0]
        if nc.get("max") is not None and nc.get("mean") is not None:
            insights.append(f"{nc['name'].replace('_',' ').title()} ranges {nc['min']:.1f}–{nc['max']:.1f} (avg {nc['mean']:.1f}).")
    cat_cols = [c for c in profile["columns"] if c["semantic"] == "categorical"]
    if cat_cols:
        cc = cat_cols[0]
        insights.append(f"{cc['name'].replace('_',' ').title()} has {cc['n_unique']:,} distinct values.")
    return insights[:5]

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
        kpis.append({"label": nc["name"].upper().replace("_"," "), "metric": m, "column": nc["name"], "format": fmt})
    if cat:
        kpis.append({"label": f"UNIQUE {cat[0]['name'].upper().replace('_',' ')}",
                     "metric": "count_distinct", "column": cat[0]["name"], "format": "number"})

    charts = []
    if dt and num:
        charts.append({"id":"hero","type":"area","x":dt[0]["name"],"y":num[0]["name"],
                        "color":cat[0]["name"] if cat else None,"agg":"sum","span":2,
                        "title":f"{num[0]['name'].replace('_',' ').title()} Over Time","subtitle":"Trend across the full date range"})
    elif cat and num:
        charts.append({"id":"hero","type":"bar","x":cat[0]["name"],"y":num[0]["name"],"agg":"mean","span":2,
                        "title":f"{num[0]['name'].replace('_',' ').title()} by {cat[0]['name'].replace('_',' ').title()}","subtitle":"Average by category"})
    elif len(num) >= 2:
        charts.append({"id":"hero","type":"scatter","x":num[0]["name"],"y":num[1]["name"],
                        "color":cat[0]["name"] if cat else None,"agg":"none","span":2,
                        "title":f"{num[1]['name'].replace('_',' ').title()} vs {num[0]['name'].replace('_',' ').title()}","subtitle":"Relationship between two key metrics"})
    elif num:
        charts.append({"id":"hero","type":"histogram","x":num[0]["name"],"span":2,
                        "title":f"Distribution of {num[0]['name'].replace('_',' ').title()}","subtitle":"Frequency distribution"})

    if cat and num and len(charts)<6:
        charts.append({"type":"donut","x":cat[0]["name"],"y":num[0]["name"],"agg":"sum","span":1,"title":f"Share by {cat[0]['name'].replace('_',' ').title()}"})
    if len(cat)>=2 and num and len(charts)<6:
        charts.append({"type":"bar","x":cat[1]["name"],"y":num[0]["name"],"agg":"mean","span":1,"title":f"{num[0]['name'].replace('_',' ').title()} by {cat[1]['name'].replace('_',' ').title()}"})
    if num and len(charts)<6:
        charts.append({"type":"histogram","x":num[-1]["name"],"agg":"none","span":1,"title":f"{num[-1]['name'].replace('_',' ').title()} Distribution"})
    if len(cat)>=2 and num and len(charts)<6:
        charts.append({"type":"heatmap","x":cat[0]["name"],"y":cat[1]["name"],"z":num[0]["name"],"agg":"mean","span":1,"title":f"{num[0]['name'].replace('_',' ').title()} Matrix"})
    if len(num)>=3 and len(charts)<7:
        charts.append({"type":"scatter3d","x":num[0]["name"],"y":num[1]["name"],"z":num[2]["name"],
                        "color":cat[0]["name"] if cat else None,"agg":"none","span":1,
                        "title":f"3D: {num[0]['name'].replace('_',' ')} × {num[1]['name'].replace('_',' ')} × {num[2]['name'].replace('_',' ')}","subtitle":"Interactive — drag to rotate"})
    if len(cat)>=2 and num and len(charts)<7:
        charts.append({"type":"surface3d","x":cat[0]["name"],"y":cat[1]["name"],"z":num[0]["name"],"agg":"mean","span":1,
                        "title":f"3D Surface: {num[0]['name'].replace('_',' ').title()}","subtitle":"Mean values across two dimensions"})
    anim_col = next((c for c in cat if 3<=c["n_unique"]<=15 and c["name"]!=(cat[0]["name"] if cat else "")), None)
    if anim_col and cat and num and len(charts)<7:
        charts.append({"type":"animated_bar","x":cat[0]["name"],"y":num[0]["name"],"animation_frame":anim_col["name"],"agg":"mean","span":2,
                        "title":f"{num[0]['name'].replace('_',' ').title()} — Animated by {anim_col['name'].replace('_',' ').title()}","subtitle":"Press ▶ to play the animation"})

    fname = profile.get("filename","Dataset").rsplit(".",1)[0].replace("_"," ").title()
    return {"title":f"{fname} Insights","subtitle":f"{profile['rows']:,} records across {profile['usable_cols']} dimensions","kpis":kpis,"charts":charts}

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
                             "units":int(max(1,rev/rng.uniform(120,200))),"margin_pct":round(float(rng.uniform(8,28)),1)})
    return pd.DataFrame(rows)

def build_export_html(dashboard: dict) -> str:
    kpi_html = ""
    colors = ["#22d3ee","#a78bfa","#10b981","#f59e0b","#5b6ef5","#f87171"]
    icons  = ["💰","📈","🎯","📦","⚡","🔢"]
    for i, k in enumerate(dashboard.get("kpis", [])):
        val   = k.get("formatted_value") or format_kpi_value(k.get("value", 0), k.get("format","number"))
        color = colors[i % len(colors)]; icon = icons[i % len(icons)]
        sub   = (k.get("column") or "total") + " · " + k.get("metric","count")
        kpi_html += f'<div class="kpi-card" style="--kc:{color}"><div class="kpi-top"><div class="kpi-lbl">{k.get("label","KPI")}</div><div class="kpi-ico">{icon}</div></div><div class="kpi-val">{val}</div><div class="kpi-sub">{sub}</div></div>'

    charts     = dashboard.get("charts", [])
    hero       = next((c for c in charts if c.get("span",1) >= 2), charts[0] if charts else None)
    subs       = [c for c in charts if c is not hero]
    chart_data = json.dumps({f"fig_{c['id']}": c["figure"] for c in charts if c.get("figure")})
    hero_html  = ""
    if hero and hero.get("figure"):
        hero_html = f'<div class="chart-card hero-card"><div class="chart-hd"><span class="chart-title">{hero.get("title","")}</span></div><div id="fig_{hero["id"]}" class="chart-div hero-div"></div></div>'
    subs_html = "".join(f'<div class="chart-card"><div class="chart-hd"><span class="chart-title">{c.get("title","")}</span></div><div id="fig_{c["id"]}" class="chart-div sub-div"></div></div>' for c in subs if c.get("figure"))
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>{dashboard.get('title','Dashboard')}</title><script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script><style>@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Space+Grotesk:wght@400;500;600&display=swap');*{{margin:0;padding:0;box-sizing:border-box}}body{{background:#0C162A;color:#F7F8FB;font-family:'Plus Jakarta Sans',system-ui,sans-serif;padding:32px 28px}}.kpi-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:22px}}.kpi-card{{background:#1e2b4a;border:1px solid rgba(68,104,176,0.2);border-radius:14px;padding:20px;position:relative}}.kpi-card::before{{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--kc,#4468B0);border-radius:14px 14px 0 0}}.kpi-val{{font-size:28px;font-weight:700;margin:8px 0 4px;color:#F7F8FB}}.kpi-lbl{{font-family:'Space Grotesk',sans-serif;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#92A0BA}}.chart-card{{background:#1e2b4a;border:1px solid rgba(68,104,176,0.2);border-radius:14px;padding:18px;margin-bottom:16px}}.hero-div{{height:400px;width:100%}}.sub-div{{height:300px;width:100%}}.sub-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px}}</style></head><body><h1 style="margin-bottom:8px">{dashboard.get('title','Dashboard')}</h1><p style="color:#607090;margin-bottom:24px">{dashboard.get('subtitle','')}</p><div class="kpi-grid">{kpi_html}</div>{hero_html}<div class="sub-grid">{subs_html}</div><footer style="text-align:center;padding:28px 0;font-size:10px;color:#1a2540">Generated by JMData Talent Dash · {ts}</footer><script>const F={chart_data};Object.entries(F).forEach(([id,fig])=>{{const el=document.getElementById(id);if(!el||!fig)return;const L=Object.assign({{}},fig.layout||{{}},{{autosize:true,paper_bgcolor:"rgba(0,0,0,0)",plot_bgcolor:"rgba(0,0,0,0)"}});if(fig.frames&&fig.frames.length){{Plotly.newPlot(el,fig.data||[],L,{{responsive:true}}).then(()=>Plotly.addFrames(el,fig.frames));}}else{{Plotly.newPlot(el,fig.data||[],L,{{responsive:true}});}}}});</script></body></html>"""

@app.api_route("/health", methods=["GET", "HEAD"])
def health(response: Response):
    providers = {p: bool(os.environ.get(kv)) for p, (_, kv) in _CALLERS.items()}
    return {"status": "ok", "providers": providers}

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw: raise HTTPException(400, "Empty file")
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
    filter_col: str | None = None
    filter_val: str | None = None
    force_fresh: bool = False   # True = call LLM (Regenerate btn). False = reuse stored plan if available.

@app.post("/api/generate/{dataset_id}")
async def generate(dataset_id: str, body: GenReq | None = None):
    item   = _get(dataset_id)
    df, profile = item["df"], item["profile"]
    seed   = (body.seed if body and body.seed else random.randint(0, 999999))

    # Apply filter to dataframe if provided
    filter_col = body.filter_col if body else None
    filter_val = body.filter_val if body else None
    if filter_col and filter_val and filter_col in df.columns:
        df = df[df[filter_col].astype(str) == str(filter_val)].copy()
        logger.info(f"Filter applied: {filter_col}={filter_val} → {len(df)} rows")
        if df.empty:
            raise HTTPException(400, f"No rows match filter: {filter_col} = '{filter_val}'")

    # Reuse stored plan when filtering (skip LLM re-call), call LLM only on fresh generate
    # Reuse stored plan when: plan exists AND caller didn't force a fresh LLM call.
    # Filter apply, clear filter → reuse plan (zero LLM calls, instant).
    # Regenerate button → force_fresh=True → always calls LLM.
    force_fresh = body.force_fresh if body else False
    stored = item.get("plan")
    if stored and not force_fresh:
        plan, provider = stored["plan"], stored["provider"]
        logger.info(f"Reusing stored plan (no LLM), provider={provider}")
    else:
        plan, provider = _call_llm(_build_prompt(profile))
        if not plan:
            plan = _fallback_plan(profile, seed); provider = "rules"
        item["plan"] = {"plan": plan, "provider": provider}   # store for all future filter ops
    logger.info(f"provider={provider} charts={len(plan.get('charts',[]))}")
    valid_cols = {c["name"] for c in profile["columns"]}

    kpis = []
    for k in (plan.get("kpis") or [])[:6]:
        if k.get("column") and k["column"] not in valid_cols: continue
        kpi = compute_kpi(k, df)
        kpi["formatted_value"] = format_kpi_value(kpi["value"], kpi["format"])
        kpi["trend_pct"] = _compute_trend(df, k.get("column"), k.get("metric","count"))
        kpis.append(kpi)
    if not kpis:
        for k in _fallback_plan(profile, seed)["kpis"]:
            kpi = compute_kpi(k, df)
            kpi["formatted_value"] = format_kpi_value(kpi["value"], kpi["format"])
            kpi["trend_pct"] = _compute_trend(df, k.get("column"), k.get("metric","count"))
            kpis.append(kpi)

    charts = []
    for i, spec in enumerate(plan.get("charts") or []):
        refs = [spec.get(k) for k in ("x","y","z","color","animation_frame") if spec.get(k)]
        if not all(r in valid_cols for r in refs):
            logger.warning(f"Skipping chart '{spec.get('type')}' — bad cols {refs}"); continue
        fig, actual_type = build_chart_with_fallback(spec, df)
        if not fig: continue
        charts.append({"id": spec.get("id") or f"c{i}", "type": actual_type,
                        "title": spec.get("title","Chart"), "subtitle": spec.get("subtitle"),
                        "span": int(spec.get("span",1)), "figure": fig, "spec": spec})

    if not charts:
        fb = _fallback_plan(profile, seed)
        for i, spec in enumerate(fb["charts"]):
            fig, actual_type = build_chart_with_fallback(spec, df)
            if fig:
                charts.append({"id":spec.get("id","c"),"type":actual_type,"title":spec.get("title","Chart"),
                               "subtitle":spec.get("subtitle"),"span":int(spec.get("span",1)),"figure":fig,"spec":spec})

    return {
        "dataset_id": dataset_id,
        "title": plan.get("title","Dashboard"),
        "subtitle": plan.get("subtitle",""),
        "kpis": kpis,
        "charts": charts,
        "insights": plan.get("insights") or _fallback_insights(profile, kpis),
        "provider": provider,
        "seed": seed,
        "filter": {"col": filter_col, "val": filter_val} if filter_col and filter_val else None,
    }

class ExportReq(BaseModel):
    dashboard: dict

@app.post("/api/export/html")
async def export_html(req: ExportReq):
    html = build_export_html(req.dashboard)
    title = req.dashboard.get("title","dashboard").replace(" ","_")
    return HTMLResponse(content=html, headers={"Content-Disposition": f'attachment; filename="{title}.html"'})

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

class ChartUpdateReq(BaseModel):
    did: str
    spec: dict

@app.post("/api/chart/update")
async def chart_update(req: ChartUpdateReq):
    item = _get(req.did)
    df, profile = item["df"], item["profile"]
    valid_cols = {c["name"] for c in profile["columns"]}
    refs = [req.spec.get(k) for k in ("x","y","z","color","animation_frame") if req.spec.get(k)]
    bad = [r for r in refs if r not in valid_cols]
    if bad: raise HTTPException(400, f"Unknown columns: {bad}")
    fig, actual_type = build_chart_with_fallback(req.spec, df)
    if not fig: raise HTTPException(422, "Could not render chart with given spec")
    return {"figure": fig, "type": actual_type, "spec": req.spec}

class ChatReq(BaseModel):
    did: str
    message: str
    current_charts: list = []
    history: list = []

@app.post("/api/chat")
async def chat(req: ChatReq):
    item = _get(req.did)
    profile = item["profile"]
    schema_lines = [f"  {c['name']} ({c['semantic']}, unique={c['n_unique']})" for c in profile["columns"]]
    schema_str = "\n".join(schema_lines)
    charts_str = ""
    if req.current_charts:
        chart_descs = [f"  id={ch.get('id','?')} type={ch.get('type','?')} title={ch.get('title','?')}" for ch in req.current_charts[:6]]
        charts_str = "\nCurrent charts:\n" + "\n".join(chart_descs)
    system_with_context = (CHAT_SYSTEM_PROMPT + f"\n\nDataset: {profile['filename']} ({profile['rows']:,} rows)\nSchema:\n{schema_str}{charts_str}")
    messages = [{"role":"system","content":system_with_context}]
    for h in req.history[-6:]:
        messages.append({"role": h.get("role","user"), "content": h.get("content","")})
    messages.append({"role":"user","content":req.message})
    raw_reply = _call_llm_chat(messages)
    actions = []
    action_match = re.search(r"<action>([\s\S]*?)</action>", raw_reply)
    if action_match:
        try:
            actions.append(json.loads(action_match.group(1).strip()))
        except:
            pass
    reply_text = re.sub(r"<action>[\s\S]*?</action>", "", raw_reply).strip()
    return {"reply": reply_text, "actions": actions}
