"""
DashAI Backend — FastAPI
Serves one endpoint: POST /api/generate-spec

LLM cascade priority (mirrors your llm_utils.py):
  1. Groq      — llama-3.3-70b-versatile   14,400 req/day FREE
  2. Gemini    — gemini-2.5-flash-lite       1,000 req/day FREE
  3. OpenAI    — gpt-4o-mini               paid
  4. Anthropic — claude-haiku              paid

Set keys in HuggingFace Space → Settings → Repository secrets.
"""

import os, re, json, logging
from typing import Any, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dashai")

app = FastAPI(title="DashAI", version="1.0.0")

# ── CORS: allow your Netlify/Vercel frontend domain ──────────────
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# ── Model defaults (from llm_utils.py) ──────────────────────────
DEFAULT_GROQ_MODEL      = "llama-3.3-70b-versatile"
DEFAULT_GEMINI_MODEL    = "gemini-2.5-flash-lite"
DEFAULT_OPENAI_MODEL    = "gpt-4o-mini"
DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"

PRIORITY = ["groq", "gemini", "openai", "anthropic"]

# ============================================================
# PYDANTIC SCHEMAS
# ============================================================
class ColProfile(BaseModel):
    name: str
    type: str           # "numeric" | "categorical" | "datetime"
    unique: int
    nulls: int
    min: Optional[float] = None
    max: Optional[float] = None
    mean: Optional[float] = None
    sum: Optional[float] = None
    sample: List[str] = []

class GenerateRequest(BaseModel):
    columns: List[ColProfile]
    row_count: int
    sample_rows: List[dict] = []

# ============================================================
# PROMPT BUILDER
# ============================================================
def build_prompt(req: GenerateRequest) -> str:
    col_lines = []
    for c in req.columns:
        base = f'"{c.name}" [{c.type}]: unique={c.unique}, nulls={c.nulls}'
        if c.min is not None:
            base += f", min={c.min:.1f}, max={c.max:.1f}, mean={c.mean:.1f}, sum={c.sum:.0f}"
        base += f", samples=[{', '.join(c.sample[:4])}]"
        col_lines.append(base)

    return f"""You are a data visualization expert. Analyze this dataset and return a JSON dashboard specification.
Return ONLY valid JSON. No markdown, no explanation, no extra text.

Dataset: {req.row_count} rows, {len(req.columns)} columns
Columns:
{chr(10).join(col_lines)}

Return this exact JSON (no extra keys, no comments):
{{
  "title": "Business-friendly title (4-7 words, be specific to the data)",
  "summary": "One concrete insight sentence about what this data actually shows",
  "insights": [
    "Specific insight with numbers e.g. Revenue peaked in Q3 at $420K",
    "Specific trend or pattern visible in the data",
    "Actionable observation about the dataset"
  ],
  "kpis": [
    {{"label": "KPI label", "column": "exactColumnName", "agg": "sum|mean|count|max|min", "format": "currency|number|percent", "color": "#06b6d4", "icon": "💰"}}
  ],
  "charts": [
    {{
      "id": "hero",
      "type": "line|bar|scatter|pie|histogram|box|heatmap|scatter3d",
      "x": "exactColumnName or null",
      "y": "exactColumnName or null",
      "z": null,
      "color": null,
      "values": null,
      "labels": null,
      "title": "Business chart title",
      "insight": "What this chart reveals in one sentence",
      "size": "hero",
      "animated": false
    }}
  ]
}}

Rules (follow strictly — column names are case-sensitive):
1. kpis: 3-4 cards. Prefer revenue/sales columns for sum, rate/score for mean.
   Use colors: ["#06b6d4","#8b5cf6","#10b981","#f59e0b"] (one per KPI).
   Use icons: 💰 for revenue, 📈 for growth, 🎯 for rate/score, 📦 for count/units.
2. First chart size "hero" = most impactful. 3-5 charts total, DIFFERENT types.
3. Set "animated":true ONLY for line charts with a datetime x-axis and 6+ unique x values.
4. For pie: fill "values" and "labels" columns; set x/y to null.
5. For scatter3d: only if 3+ numeric cols; fill x, y, z.
6. For box: y can be an array ["col1","col2","col3"] (up to 4 numeric cols).
7. For heatmap: leave x, y, z null — backend auto-builds correlation matrix.
8. Never repeat the same chart type. All column names must match exactly.
9. If a datetime column exists: make it the hero animated line chart.
10. Chart titles must be human-readable: "Revenue by Region" not "Revenue groupby Region".
"""

# ============================================================
# FALLBACK SPEC (no LLM needed)
# ============================================================
def fallback_spec(req: GenerateRequest) -> dict:
    num  = [c for c in req.columns if c.type == "numeric"]
    cat  = [c for c in req.columns if c.type == "categorical"]
    dt   = [c for c in req.columns if c.type == "datetime"]
    charts = []

    KPI_COLORS = ["#06b6d4","#8b5cf6","#10b981","#f59e0b"]
    KPI_ICONS  = ["💰","📈","🎯","📦"]
    kpis = []
    for i, c in enumerate(num[:4]):
        agg = "sum" if any(w in c.name.lower() for w in ["revenue","sales","amount","total","cost","price","profit"]) else "mean"
        fmt = "currency" if any(w in c.name.lower() for w in ["revenue","sales","amount","cost","price","profit"]) else "number"
        kpis.append({"label": c.name.replace("_"," ").title(), "column": c.name, "agg": agg, "format": fmt, "color": KPI_COLORS[i], "icon": KPI_ICONS[i]})

    if dt and num:
        charts.append({"id":"hero","type":"line","x":dt[0].name,"y":num[0].name,"title":f"{num[0].name.replace('_',' ')} Over Time","insight":"Trend over time period","size":"hero","animated":True})
    elif cat and num:
        charts.append({"id":"hero","type":"bar","x":cat[0].name,"y":num[0].name,"title":f"{num[0].name.replace('_',' ')} by {cat[0].name.replace('_',' ')}","insight":"Performance by category","size":"hero","animated":False})
    elif len(num) >= 2:
        charts.append({"id":"hero","type":"scatter","x":num[0].name,"y":num[1].name,"title":f"{num[0].name} vs {num[1].name}","insight":"Correlation analysis","size":"hero","animated":False})

    if cat and num:
        charts.append({"id":"c2","type":"pie","values":num[0].name,"labels":cat[0].name,"x":None,"y":None,"title":f"{cat[0].name.replace('_',' ')} Breakdown","insight":"Proportional share","size":"medium","animated":False})
    if len(num) >= 2:
        charts.append({"id":"c3","type":"histogram","x":num[min(1,len(num)-1)].name,"y":None,"title":"Distribution Analysis","insight":"Value frequency spread","size":"medium","animated":False})
    if len(num) >= 2:
        y_cols = [c.name for c in num[:4]]
        charts.append({"id":"c4","type":"box","x":None,"y":y_cols,"title":"Statistical Overview","insight":"Quartile comparison","size":"medium","animated":False})
    if len(num) >= 3:
        charts.append({"id":"c5","type":"heatmap","x":None,"y":None,"z":None,"title":"Correlation Matrix","insight":"Feature relationships","size":"medium","animated":False})

    insights = [
        f"{len(num)} numeric and {len(cat)} categorical columns detected",
        f"{num[0].name} ranges from {num[0].min:.1f} to {num[0].max:.1f}" if num and num[0].min is not None else "Explore the patterns in your data",
        f"{cat[0].name} has {cat[0].unique} unique values" if cat else "Analyze numeric distributions"
    ]

    return {"title": "Data Overview Dashboard", "summary": f"Analysis of {req.row_count:,} records across {len(req.columns)} dimensions", "insights": insights, "kpis": kpis, "charts": charts}

# ============================================================
# LLM CALLERS (mirrors your llm_utils.py _call_* functions)
# ============================================================
def _parse_json(raw: str) -> Any:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines and lines[-1].strip() == "```" else lines[1:])
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError("No JSON object found in response")
    return json.loads(m.group(0))

def _call_groq(prompt: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["GROQ_API_KEY"], base_url="https://api.groq.com/openai/v1")
    model  = os.environ.get("LLM_MODEL_GROQ", DEFAULT_GROQ_MODEL)
    resp   = client.chat.completions.create(
        model=model, max_tokens=1800, temperature=0.7,
        messages=[
            {"role": "system", "content": "Return ONLY valid JSON. No markdown fences. No explanation."},
            {"role": "user",   "content": prompt},
        ],
    )
    return resp.choices[0].message.content

def _call_gemini(prompt: str) -> str:
    from google import genai
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
    model  = os.environ.get("LLM_MODEL_GEMINI", DEFAULT_GEMINI_MODEL)
    resp   = client.models.generate_content(model=model, contents=prompt)
    return resp.text

def _call_openai(prompt: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    model  = os.environ.get("LLM_MODEL_OPENAI", DEFAULT_OPENAI_MODEL)
    resp   = client.chat.completions.create(
        model=model, max_tokens=1800, temperature=0.7,
        messages=[
            {"role": "system", "content": "Return ONLY valid JSON. No markdown. No extra text."},
            {"role": "user",   "content": prompt},
        ],
    )
    return resp.choices[0].message.content

def _call_anthropic(prompt: str) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    model  = os.environ.get("LLM_MODEL_ANTHROPIC", DEFAULT_ANTHROPIC_MODEL)
    msg    = client.messages.create(
        model=model, max_tokens=1800,
        system="Return ONLY valid JSON. No markdown. No extra text.",
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text

_CALLERS = {
    "groq":      (_call_groq,      "GROQ_API_KEY"),
    "gemini":    (_call_gemini,    "GOOGLE_API_KEY"),
    "openai":    (_call_openai,    "OPENAI_API_KEY"),
    "anthropic": (_call_anthropic, "ANTHROPIC_API_KEY"),
}

def _call_llm(prompt: str) -> str:
    configured = os.environ.get("LLM_PROVIDER", "groq").lower().strip()
    ordered    = [configured] + [p for p in PRIORITY if p != configured]
    last_exc   = RuntimeError("No LLM provider available — set at least one API key")

    for prov in ordered:
        caller, key_var = _CALLERS[prov]
        if not os.environ.get(key_var):
            logger.debug(f"[LLM] Skipping {prov} — {key_var} not set")
            continue
        try:
            result = caller(prompt)
            if prov != configured:
                logger.info(f"[LLM] Fell back to {prov} (primary={configured} failed)")
            return result
        except Exception as exc:
            logger.warning(f"[LLM] {prov} failed: {exc}")
            last_exc = exc

    raise last_exc

# ============================================================
# ENDPOINTS
# ============================================================
@app.get("/health")
def health():
    configured_keys = {p: bool(os.environ.get(kv)) for p, (_, kv) in _CALLERS.items()}
    return {"status": "ok", "providers": configured_keys}

@app.post("/api/generate-spec")
async def generate_spec(req: GenerateRequest):
    if not req.columns:
        raise HTTPException(400, "No columns provided")

    all_names = {c.name for c in req.columns}
    prompt    = build_prompt(req)

    try:
        raw  = _call_llm(prompt)
        spec = _parse_json(raw)

        # Validate + fix column references
        valid_charts = []
        for c in (spec.get("charts") or []):
            refs = [c.get("x"), c.get("y"), c.get("z"), c.get("color"), c.get("values"), c.get("labels")]
            refs = [r for r in refs if r and r not in ("null","None","undefined")]
            # y can be a list (box chart)
            if isinstance(c.get("y"), list):
                refs = [r for r in refs if r != c["y"]] + c["y"]
            if all(r in all_names for r in refs):
                valid_charts.append(c)

        if not valid_charts:
            logger.warning("[DashAI] All AI charts had invalid columns — using fallback")
            return fallback_spec(req)

        spec["charts"] = valid_charts

        # Validate kpis
        valid_kpis = [k for k in (spec.get("kpis") or []) if k.get("column") in all_names]
        if not valid_kpis:
            fb = fallback_spec(req)
            spec["kpis"] = fb["kpis"]
        else:
            spec["kpis"] = valid_kpis

        return spec

    except Exception as exc:
        logger.warning(f"[DashAI] LLM/parse failed: {exc} — using fallback spec")
        return fallback_spec(req)
