"""AI dashboard planner with multi-provider fallback (Groq -> Gemini -> rules)."""
from __future__ import annotations

import json
import logging
import os
import random
from typing import Any

logger = logging.getLogger(__name__)


# ---------- Prompt construction ----------

PLANNER_SYSTEM = """You are an elite data analyst and dashboard designer.
Given a dataset profile, design a premium, interactive analytics dashboard.

Output a STRICT JSON object only (no markdown, no commentary) with this schema:
{
  "title": "short, business-friendly dashboard title",
  "subtitle": "one-sentence narrative summary of what this data shows",
  "kpis": [
    {"label": "UPPERCASE SHORT LABEL", "metric": "sum|mean|max|min|count|count_distinct", "column": "column_name OR null for row count", "format": "number|currency|percent"}
  ],
  "charts": [
    {
      "id": "hero",
      "type": "bar|line|scatter|pie|donut|histogram|box|heatmap|treemap|area|scatter_3d",
      "x": "column or null",
      "y": "column or null",
      "color": "column or null",
      "size": "column or null",
      "z": "column or null (only for 3d/heatmap)",
      "agg": "sum|mean|count|none",
      "title": "Business-friendly chart title",
      "subtitle": "Optional short caption",
      "span": 2,
      "reason": "why this chart"
    }
  ],
  "accent_palette": "neon"
}

Rules:
- Pick 3-6 KPI cards summarising the most important numbers.
- Pick exactly ONE hero chart (id="hero", span=2) followed by 3-5 supporting charts (span=1).
- Vary the chart types across the dashboard (no duplicates back-to-back).
- ONLY use column names that exist in the provided schema.
- Prefer datetime+numeric -> line/area, category+numeric -> bar, two numerics -> scatter, single numeric -> histogram, distribution -> box, category proportions -> donut, two categories+numeric -> heatmap.
- Use 3d only when there are >=3 strong numeric columns AND it tells a real story.
- KPI columns must be numeric (or null=row count).
- Output JSON ONLY.
"""


def _build_user_prompt(profile: dict[str, Any]) -> str:
    cols = profile["columns"]
    schema_lines = []
    for c in cols:
        bits = [f"  - {c['name']} ({c['semantic']}, dtype={c['dtype']}, unique={c['n_unique']}, nulls={c['n_null']})"]
        if c.get("min") is not None:
            bits.append(f"min={c['min']}, max={c['max']}, mean={c.get('mean')}")
        if c.get("sample_values"):
            sv = ", ".join(str(v)[:24] for v in c["sample_values"][:5])
            bits.append(f"samples=[{sv}]")
        schema_lines.append(" | ".join(bits))
    schema = "\n".join(schema_lines)
    return f"""Dataset: {profile.get('filename','dataset')}
Rows: {profile['rows']}, Columns: {profile['cols']}

Schema:
{schema}

Design a premium dashboard for this data. Return ONLY the JSON object."""


# ---------- Groq provider (primary) ----------

async def _call_groq(profile: dict[str, Any], seed: int) -> dict[str, Any] | None:
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        from groq import AsyncGroq
        client = AsyncGroq(api_key=api_key)
        resp = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": PLANNER_SYSTEM},
                {"role": "user", "content": _build_user_prompt(profile)},
            ],
            temperature=0.7,
            seed=seed,
            response_format={"type": "json_object"},
        )
        text = resp.choices[0].message.content
        return json.loads(text)
    except Exception as e:
        logger.warning(f"Groq planner failed: {e}")
        return None


# ---------- Gemini provider (fallback via Emergent LLM key) ----------

async def _call_gemini(profile: dict[str, Any], seed: int) -> dict[str, Any] | None:
    key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not key:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=key,
            session_id=f"dashai-{seed}",
            system_message=PLANNER_SYSTEM,
        ).with_model("gemini", "gemini-2.5-flash")
        msg = UserMessage(text=_build_user_prompt(profile) + "\n\nRespond with JSON only.")
        text = await chat.send_message(msg)
        # Strip markdown fences if present
        text = text.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].strip()
        # Find first { and last }
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            text = text[start : end + 1]
        return json.loads(text)
    except Exception as e:
        logger.warning(f"Gemini planner failed: {e}")
        return None


# ---------- Rule-based fallback ----------

def _rule_based_plan(profile: dict[str, Any], seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    cols = profile["columns"]
    numeric = [c for c in cols if c["semantic"] == "numeric"]
    categorical = [c for c in cols if c["semantic"] == "categorical"]
    datetime_cols = [c for c in cols if c["semantic"] == "datetime"]

    # KPIs
    kpis: list[dict[str, Any]] = [
        {"label": "TOTAL RECORDS", "metric": "count", "column": None, "format": "number"}
    ]
    for nc in numeric[:3]:
        metric = rng.choice(["sum", "mean", "max"])
        kpis.append(
            {
                "label": f"{metric.upper()} {nc['name'].upper()}",
                "metric": metric,
                "column": nc["name"],
                "format": "number",
            }
        )
    if categorical:
        kpis.append(
            {
                "label": f"UNIQUE {categorical[0]['name'].upper()}",
                "metric": "count_distinct",
                "column": categorical[0]["name"],
                "format": "number",
            }
        )

    charts: list[dict[str, Any]] = []

    # Hero chart
    if datetime_cols and numeric:
        charts.append(
            {
                "id": "hero",
                "type": "area",
                "x": datetime_cols[0]["name"],
                "y": numeric[0]["name"],
                "color": categorical[0]["name"] if categorical else None,
                "agg": "sum",
                "title": f"{numeric[0]['name'].title()} Over Time",
                "subtitle": "Trend across the full date range",
                "span": 2,
            }
        )
    elif categorical and numeric:
        charts.append(
            {
                "id": "hero",
                "type": "bar",
                "x": categorical[0]["name"],
                "y": numeric[0]["name"],
                "color": None,
                "agg": "sum",
                "title": f"{numeric[0]['name'].title()} by {categorical[0]['name'].title()}",
                "subtitle": "Top categories ranked by total",
                "span": 2,
            }
        )
    elif len(numeric) >= 2:
        charts.append(
            {
                "id": "hero",
                "type": "scatter",
                "x": numeric[0]["name"],
                "y": numeric[1]["name"],
                "color": categorical[0]["name"] if categorical else None,
                "agg": "none",
                "title": f"{numeric[1]['name'].title()} vs {numeric[0]['name'].title()}",
                "subtitle": "Relationship between two key metrics",
                "span": 2,
            }
        )
    elif numeric:
        charts.append(
            {
                "id": "hero",
                "type": "histogram",
                "x": numeric[0]["name"],
                "y": None,
                "color": None,
                "agg": "none",
                "title": f"Distribution of {numeric[0]['name'].title()}",
                "subtitle": "Frequency across value ranges",
                "span": 2,
            }
        )

    # Supporting charts
    if categorical and numeric and len(charts) < 5:
        charts.append(
            {
                "type": "donut",
                "x": categorical[0]["name"],
                "y": numeric[0]["name"],
                "agg": "sum",
                "title": f"Share by {categorical[0]['name'].title()}",
                "span": 1,
            }
        )
    if len(numeric) >= 2 and len(charts) < 5:
        charts.append(
            {
                "type": "scatter",
                "x": numeric[0]["name"],
                "y": numeric[1]["name"],
                "color": categorical[0]["name"] if categorical else None,
                "agg": "none",
                "title": f"{numeric[1]['name'].title()} vs {numeric[0]['name'].title()}",
                "span": 1,
            }
        )
    if numeric and len(charts) < 5:
        charts.append(
            {
                "type": "histogram",
                "x": numeric[-1]["name"],
                "agg": "none",
                "title": f"{numeric[-1]['name'].title()} Distribution",
                "span": 1,
            }
        )
    if len(categorical) >= 2 and numeric and len(charts) < 6:
        charts.append(
            {
                "type": "heatmap",
                "x": categorical[0]["name"],
                "y": categorical[1]["name"],
                "z": numeric[0]["name"],
                "agg": "mean",
                "title": f"{numeric[0]['name'].title()} matrix",
                "span": 1,
            }
        )
    if numeric and len(charts) < 6:
        charts.append(
            {
                "type": "box",
                "x": categorical[0]["name"] if categorical else None,
                "y": numeric[0]["name"],
                "agg": "none",
                "title": f"{numeric[0]['name'].title()} Range",
                "span": 1,
            }
        )

    title_seeds = [
        f"{profile.get('filename','Dataset').rsplit('.',1)[0].title()} Insights",
        f"{profile.get('filename','Dataset').rsplit('.',1)[0].title()} Performance",
        f"Live View · {profile.get('filename','Dataset').rsplit('.',1)[0].title()}",
    ]
    return {
        "title": rng.choice(title_seeds),
        "subtitle": f"{profile['rows']:,} records analysed across {profile['cols']} dimensions.",
        "kpis": kpis,
        "charts": charts,
        "accent_palette": "neon",
    }


# ---------- Public entry ----------

async def plan_dashboard(profile: dict[str, Any], seed: int | None = None) -> tuple[dict[str, Any], str]:
    """Return (plan, provider_used)."""
    if seed is None:
        seed = random.randint(0, 1_000_000)
    plan = await _call_groq(profile, seed)
    if plan and isinstance(plan, dict) and plan.get("charts"):
        return plan, "groq"
    plan = await _call_gemini(profile, seed)
    if plan and isinstance(plan, dict) and plan.get("charts"):
        return plan, "gemini"
    return _rule_based_plan(profile, seed), "rules"
