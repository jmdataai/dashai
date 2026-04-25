"""
DashAI Backend — FastAPI
POST /api/generate-spec  → AI dashboard spec
GET  /health             → status (for UptimeRobot)
HEAD /health             → status (for UptimeRobot ping)

LLM cascade (free-tier priority):
  1. Groq      — llama-3.3-70b-versatile   14,400 req/day FREE
  2. Gemini    — gemini-2.5-flash-lite       1,000 req/day FREE
  3. OpenAI    — gpt-4o-mini               paid
  4. Anthropic — claude-haiku              paid
"""

import os, re, json, logging
from typing import Any, List, Optional
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dashai")

app = FastAPI(title="DashAI", version="1.0.0")

# CORS — set ALLOWED_ORIGINS env var to your Vercel URL for security
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "HEAD", "OPTIONS"],
    allow_headers=["*"],
)

# ── Model defaults ────────────────────────────────────────────
DEFAULT_GROQ_MODEL      = "llama-3.3-70b-versatile"
DEFAULT_GEMINI_MODEL    = "gemini-2.5-flash-lite"
DEFAULT_OPENAI_MODEL    = "gpt-4o-mini"
DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
PRIORITY = ["groq", "gemini", "openai", "anthropic"]

# ── Schemas ───────────────────────────────────────────────────
class ColProfile(BaseModel):
    name: str
    type: str
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

# ── Prompt ────────────────────────────────────────────────────
def build_prompt(req: GenerateRequest) -> str:
    col_lines = []
    for c in req.columns:
        line = f'"{c.name}" [{c.type}]: unique={c.unique}, nulls={c.nulls}'
        if c.min is not None:
            line += f", min={c.min:.2f}, max={c.max:.2f}, mean={c.mean:.2f}, sum={c.sum:.0f}"
        line += f", samples=[{', '.join(c.sample[:4])}]"
        col_lines.append(line)

    return f"""You are a data visualization expert. Analyze this dataset and return a JSON dashboard spec.
Return ONLY valid JSON. No markdown, no explanation, no extra text.

Dataset: {req.row_count} rows, {len(req.columns)} columns
Columns:
{chr(10).join(col_lines)}

Return this exact JSON:
{{
  "title": "Specific business-friendly title (4-7 words)",
  "summary": "One concrete insight sentence with actual numbers from the data",
  "insights": [
    "Specific insight with numbers e.g. North region leads at $1.2M revenue",
    "Another specific trend or pattern",
    "Actionable observation"
  ],
  "kpis": [
    {{"label": "KPI Name", "column": "exactColName", "agg": "sum|mean|count|max|min", "format": "currency|number|percent", "color": "#22d3ee", "icon": "💰"}}
  ],
  "charts": [
    {{
      "id": "hero",
      "type": "line|bar|scatter|pie|histogram|box|heatmap|scatter3d",
      "x": "exactColName or null",
      "y": "exactColName or null",
      "z": null,
      "color": null,
      "values": null,
      "labels": null,
      "title": "Business chart title",
      "insight": "What this reveals in one sentence",
      "size": "hero",
      "animated": false
    }}
  ]
}}

Strict rules (column names are case-sensitive — must match exactly):
1. kpis: 3-4 cards. Revenue/amount cols → agg=sum, format=currency. Rate/score/margin cols → agg=mean.
   KPI colors (one each): ["#22d3ee","#a78bfa","#10b981","#f59e0b"]
   KPI icons: 💰 revenue, 📈 growth/trend, 🎯 rate/score, 📦 count/units
2. charts: first chart size="hero" (most impactful). 3-5 total charts, ALL DIFFERENT types.
3. Set animated=true ONLY for line charts where x is a datetime/ordered column with 6+ unique values.
4. pie/donut: set "values" and "labels" fields; x and y must be null.
5. scatter3d: only use if 3+ numeric columns exist; fill x, y, z all with column names.
6. box: y field can be an array of up to 4 numeric column names e.g. ["col1","col2"].
7. heatmap: leave x, y, z all null — backend builds correlation matrix automatically.
8. NEVER repeat the same chart type.
9. If a datetime or ordered month column exists → make it the hero animated line chart.
10. Chart titles must be human-readable business language.
"""

# ── Fallback spec ─────────────────────────────────────────────
def fallback_spec(req: GenerateRequest) -> dict:
    num  = [c for c in req.columns if c.type == "numeric"]
    cat  = [c for c in req.columns if c.type == "categorical"]
    dt   = [c for c in req.columns if c.type == "datetime"]
    KPI_COLORS = ["#22d3ee","#a78bfa","#10b981","#f59e0b"]
    KPI_ICONS  = ["💰","📈","🎯","📦"]
    kpis = [{"label":c.name.replace("_"," ").title(),"column":c.name,
             "agg":"sum" if any(w in c.name.lower() for w in ["revenue","sales","amount","total","cost","price","profit"]) else "mean",
             "format":"currency" if any(w in c.name.lower() for w in ["revenue","sales","amount","cost","price","profit"]) else "number",
             "color":KPI_COLORS[i],"icon":KPI_ICONS[i]} for i,c in enumerate(num[:4])]
    charts = []
    if dt and num:
        charts.append({"id":"hero","type":"line","x":dt[0].name,"y":num[0].name,"title":f"{num[0].name.replace('_',' ')} Over Time","insight":"Trend over the period","size":"hero","animated":True,"z":None,"color":None,"values":None,"labels":None})
    elif cat and num:
        charts.append({"id":"hero","type":"bar","x":cat[0].name,"y":num[0].name,"title":f"{num[0].name.replace('_',' ')} by {cat[0].name.replace('_',' ')}","insight":"Category performance","size":"hero","animated":False,"z":None,"color":None,"values":None,"labels":None})
    elif len(num) >= 2:
        charts.append({"id":"hero","type":"scatter","x":num[0].name,"y":num[1].name,"title":f"{num[0].name} vs {num[1].name}","insight":"Correlation analysis","size":"hero","animated":False,"z":None,"color":None,"values":None,"labels":None})
    if cat and num:
        charts.append({"id":"c2","type":"pie","values":num[0].name,"labels":cat[0].name,"x":None,"y":None,"title":f"{cat[0].name.replace('_',' ')} Breakdown","insight":"Proportional share","size":"medium","animated":False,"z":None,"color":None})
    if len(num) >= 2:
        charts.append({"id":"c3","type":"histogram","x":num[min(1,len(num)-1)].name,"y":None,"title":"Distribution Analysis","insight":"Frequency spread","size":"medium","animated":False,"z":None,"color":None,"values":None,"labels":None})
    if len(num) >= 2:
        charts.append({"id":"c4","type":"box","x":None,"y":[c.name for c in num[:4]],"title":"Statistical Overview","insight":"Quartile comparison","size":"medium","animated":False,"z":None,"color":None,"values":None,"labels":None})
    if len(num) >= 3:
        charts.append({"id":"c5","type":"heatmap","x":None,"y":None,"z":None,"title":"Correlation Matrix","insight":"Feature relationships","size":"medium","animated":False,"color":None,"values":None,"labels":None})
    n0=num[0] if num else None
    return {
        "title":"Data Overview Dashboard",
        "summary":f"{req.row_count:,} records across {len(req.columns)} dimensions",
        "insights":[
            f"{len(num)} numeric and {len(cat)} categorical columns",
            f"{n0.name} ranges {n0.min:.1f} – {n0.max:.1f}" if n0 and n0.min is not None else "Explore your dataset",
            f"{cat[0].name} has {cat[0].unique} unique values" if cat else "Multiple dimensions to explore",
        ],
        "kpis":kpis, "charts":charts,
    }

# ── LLM callers ───────────────────────────────────────────────
def _parse_json(raw: str) -> Any:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines and lines[-1].strip() == "```" else lines[1:])
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError("No JSON object in response")
    return json.loads(m.group(0))

def _call_groq(prompt: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["GROQ_API_KEY"], base_url="https://api.groq.com/openai/v1")
    resp = client.chat.completions.create(
        model=os.environ.get("LLM_MODEL_GROQ", DEFAULT_GROQ_MODEL),
        max_tokens=1800, temperature=0.7,
        messages=[
            {"role":"system","content":"Return ONLY valid JSON. No markdown. No explanation."},
            {"role":"user","content":prompt},
        ],
    )
    return resp.choices[0].message.content

def _call_gemini(prompt: str) -> str:
    from google import genai
    client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
    resp = client.models.generate_content(
        model=os.environ.get("LLM_MODEL_GEMINI", DEFAULT_GEMINI_MODEL),
        contents=prompt,
    )
    return resp.text

def _call_openai(prompt: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    resp = client.chat.completions.create(
        model=os.environ.get("LLM_MODEL_OPENAI", DEFAULT_OPENAI_MODEL),
        max_tokens=1800, temperature=0.7,
        messages=[
            {"role":"system","content":"Return ONLY valid JSON. No markdown."},
            {"role":"user","content":prompt},
        ],
    )
    return resp.choices[0].message.content

def _call_anthropic(prompt: str) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    msg = client.messages.create(
        model=os.environ.get("LLM_MODEL_ANTHROPIC", DEFAULT_ANTHROPIC_MODEL),
        max_tokens=1800,
        system="Return ONLY valid JSON. No markdown. No explanation.",
        messages=[{"role":"user","content":prompt}],
    )
    return msg.content[0].text

_CALLERS = {
    "groq":      (_call_groq,      "GROQ_API_KEY"),
    "gemini":    (_call_gemini,    "GOOGLE_API_KEY"),
    "openai":    (_call_openai,    "OPENAI_API_KEY"),
    "anthropic": (_call_anthropic, "ANTHROPIC_API_KEY"),
}

def _call_llm(prompt: str) -> str:
    """Cascade: configured provider first, then all others in free-tier priority order."""
    configured = os.environ.get("LLM_PROVIDER", "groq").lower().strip()
    ordered    = [configured] + [p for p in PRIORITY if p != configured]
    last_exc   = RuntimeError("No API key configured. Set GROQ_API_KEY or GOOGLE_API_KEY.")
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

# ── Endpoints ─────────────────────────────────────────────────

@app.api_route("/health", methods=["GET", "HEAD"])
def health(response: Response):
    """
    GET  /health  — returns JSON (use this in UptimeRobot for status page)
    HEAD /health  — returns 200 with no body (UptimeRobot HTTP monitor)
    Both keep HuggingFace Space awake.
    """
    providers = {p: bool(os.environ.get(kv)) for p, (_, kv) in _CALLERS.items()}
    active    = [p for p, ok in providers.items() if ok]
    if not active:
        response.status_code = 200   # still 200; frontend handles gracefully
    return {"status":"ok","providers":providers,"active":active}


@app.post("/api/generate-spec")
async def generate_spec(req: GenerateRequest):
    if not req.columns:
        raise HTTPException(400, "No columns provided")

    all_names = {c.name for c in req.columns}
    prompt    = build_prompt(req)

    try:
        raw  = _call_llm(prompt)
        spec = _parse_json(raw)

        # ── Validate column references ──
        valid_charts = []
        for c in (spec.get("charts") or []):
            y = c.get("y")
            refs = [c.get("x"), c.get("z"), c.get("color"), c.get("values"), c.get("labels")]
            refs = [r for r in refs if r and r not in ("null","None","undefined")]
            if isinstance(y, list):
                refs += y
            elif y and y not in ("null","None","undefined"):
                refs.append(y)
            if all(r in all_names for r in refs):
                valid_charts.append(c)
            else:
                bad = [r for r in refs if r not in all_names]
                logger.warning(f"[DashAI] Dropping chart '{c.get('type')}' — bad cols: {bad}")

        if not valid_charts:
            logger.warning("[DashAI] All AI charts invalid — using fallback")
            return fallback_spec(req)

        spec["charts"] = valid_charts

        # ── Validate KPI columns ──
        valid_kpis = [k for k in (spec.get("kpis") or []) if k.get("column") in all_names]
        spec["kpis"] = valid_kpis if valid_kpis else fallback_spec(req)["kpis"]

        return spec

    except Exception as exc:
        logger.warning(f"[DashAI] LLM failed: {exc} — using fallback")
        return fallback_spec(req)
