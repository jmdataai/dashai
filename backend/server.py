"""DashAI — AI-powered Plotly dashboard generator."""
from __future__ import annotations

import io
import json
import logging
import os
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import plotly.io as pio
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

from data_profile import profile_dataframe, read_dataset
from dashboard_planner import plan_dashboard
from figure_builder import build_chart, compute_kpi

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s · %(message)s")
logger = logging.getLogger("dashai")

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

# In-memory dataset cache. id -> {"df": DataFrame, "profile": dict, "uploaded_at": iso}
DATASETS: dict[str, dict[str, Any]] = {}
MAX_DATASETS = 64

app = FastAPI(title="DashAI")
api = APIRouter(prefix="/api")


# ---------- Models ----------

class DatasetResponse(BaseModel):
    id: str
    filename: str
    rows: int
    cols: int
    columns: list[dict]
    preview: list[dict]
    uploaded_at: str


class GenerateRequest(BaseModel):
    seed: int | None = None


class KpiOut(BaseModel):
    label: str
    value: float | int
    format: str = "number"
    column: str | None = None
    metric: str = "count"


class ChartOut(BaseModel):
    id: str
    type: str
    title: str
    subtitle: str | None = None
    span: int = 1
    figure: dict


class DashboardResponse(BaseModel):
    dataset_id: str
    title: str
    subtitle: str
    kpis: list[KpiOut]
    charts: list[ChartOut]
    provider: str
    seed: int
    generated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ---------- Helpers ----------

def _store(dataset_id: str, df: pd.DataFrame, profile: dict[str, Any]) -> None:
    if len(DATASETS) >= MAX_DATASETS:
        # evict oldest by uploaded_at
        oldest = min(DATASETS.items(), key=lambda kv: kv[1]["uploaded_at"])
        DATASETS.pop(oldest[0], None)
    DATASETS[dataset_id] = {
        "df": df,
        "profile": profile,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }


def _get(dataset_id: str) -> dict[str, Any]:
    item = DATASETS.get(dataset_id)
    if not item:
        raise HTTPException(status_code=404, detail="Dataset not found or expired. Please re-upload.")
    return item


# ---------- Routes ----------

@api.get("/")
async def root() -> dict[str, str]:
    return {"name": "DashAI", "status": "ok"}


@api.post("/datasets/upload", response_model=DatasetResponse)
async def upload_dataset(file: UploadFile = File(...)) -> DatasetResponse:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file uploaded")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 25 MB)")
    try:
        df = read_dataset(file.filename or "data.csv", raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}") from e
    if df.empty:
        raise HTTPException(status_code=400, detail="Dataset is empty")
    if df.shape[0] > 50000:
        df = df.head(50000)
    profile = profile_dataframe(df, file.filename or "data.csv")
    dataset_id = str(uuid.uuid4())
    _store(dataset_id, df, profile)
    return DatasetResponse(
        id=dataset_id,
        filename=profile["filename"],
        rows=profile["rows"],
        cols=profile["cols"],
        columns=profile["columns"],
        preview=profile["preview"],
        uploaded_at=DATASETS[dataset_id]["uploaded_at"],
    )


@api.get("/datasets/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(dataset_id: str) -> DatasetResponse:
    item = _get(dataset_id)
    p = item["profile"]
    return DatasetResponse(
        id=dataset_id,
        filename=p["filename"],
        rows=p["rows"],
        cols=p["cols"],
        columns=p["columns"],
        preview=p["preview"],
        uploaded_at=item["uploaded_at"],
    )


@api.post("/datasets/{dataset_id}/generate", response_model=DashboardResponse)
async def generate_dashboard(dataset_id: str, body: GenerateRequest | None = None) -> DashboardResponse:
    item = _get(dataset_id)
    df: pd.DataFrame = item["df"]
    profile = item["profile"]
    seed = (body.seed if body and body.seed is not None else random.randint(0, 1_000_000))
    plan, provider = await plan_dashboard(profile, seed=seed)
    logger.info(f"Plan provider={provider} charts={len(plan.get('charts',[]))}")

    # KPIs
    kpis_out: list[KpiOut] = []
    for k in plan.get("kpis", [])[:6]:
        kk = compute_kpi(k, df)
        kpis_out.append(KpiOut(**kk))

    # Charts
    charts_out: list[ChartOut] = []
    for idx, spec in enumerate(plan.get("charts", [])[:6]):
        fig = build_chart(spec, df)
        if not fig:
            continue
        charts_out.append(
            ChartOut(
                id=spec.get("id") or f"chart_{idx}",
                type=str(spec.get("type", "bar")),
                title=str(spec.get("title", "Chart")),
                subtitle=spec.get("subtitle"),
                span=int(spec.get("span", 1)),
                figure=fig,
            )
        )

    if not charts_out:
        # Last-resort: at least one count-bar of first column
        first = profile["columns"][0]["name"] if profile["columns"] else None
        if first:
            spec = {"type": "bar", "x": first, "title": f"Counts of {first}", "span": 2, "id": "hero"}
            fig = build_chart(spec, df)
            if fig:
                charts_out.append(ChartOut(id="hero", type="bar", title=spec["title"], span=2, figure=fig))

    return DashboardResponse(
        dataset_id=dataset_id,
        title=str(plan.get("title", "Dataset Insights")),
        subtitle=str(plan.get("subtitle", "")),
        kpis=kpis_out,
        charts=charts_out,
        provider=provider,
        seed=seed,
    )


class ExportHtmlRequest(BaseModel):
    dashboard: DashboardResponse


def _format_kpi(value: float | int, fmt: str) -> str:
    try:
        if fmt == "currency":
            return f"${value:,.0f}" if abs(value) < 1e6 else f"${value/1_000_000:.2f}M"
        if fmt == "percent":
            return f"{value:.1f}%"
        v = float(value)
        if abs(v) >= 1_000_000:
            return f"{v/1_000_000:.2f}M"
        if abs(v) >= 1_000:
            return f"{v/1_000:.1f}K"
        if v.is_integer():
            return f"{int(v):,}"
        return f"{v:,.2f}"
    except Exception:
        return str(value)


@api.post("/export/html")
async def export_html(req: ExportHtmlRequest) -> HTMLResponse:
    d = req.dashboard
    # Build per-chart HTML using plotly.io.to_html
    chart_blocks: list[str] = []
    for idx, ch in enumerate(d.charts):
        try:
            fig = pio.from_json(json.dumps(ch.figure))
        except Exception:
            continue
        # Re-apply transparent layout for HTML export visibility on dark
        fig.update_layout(paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
        html_part = pio.to_html(
            fig,
            include_plotlyjs="cdn" if idx == 0 else False,
            full_html=False,
            config={"displayModeBar": False, "responsive": True},
            div_id=f"chart-{idx}",
        )
        span = "span-2" if ch.span >= 2 else "span-1"
        chart_blocks.append(
            f"""<section class="card {span}">
                <header>
                    <h3>{ch.title}</h3>
                    {f'<p>{ch.subtitle}</p>' if ch.subtitle else ''}
                </header>
                <div class="chart-host">{html_part}</div>
            </section>"""
        )

    kpi_blocks = "".join(
        f"""<div class="kpi"><span class="kpi-label">{k.label}</span>
            <span class="kpi-value">{_format_kpi(k.value, k.format)}</span></div>"""
        for k in d.kpis
    )

    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>{d.title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,500,700,400,900&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{{box-sizing:border-box}}
  body{{margin:0;background:#04070D;color:#F8FAFC;font-family:'IBM Plex Sans',sans-serif;padding:32px}}
  header.top{{margin-bottom:32px;border-bottom:1px solid #1A2333;padding-bottom:24px}}
  header.top h1{{font-family:'Cabinet Grotesk',sans-serif;font-weight:900;font-size:40px;letter-spacing:-0.02em;margin:0 0 8px}}
  header.top p{{color:#94A3B8;margin:0;font-size:15px}}
  .kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}}
  .kpi{{background:#0E1420;border:1px solid #1A2333;border-radius:12px;padding:20px}}
  .kpi-label{{display:block;color:#94A3B8;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;margin-bottom:8px}}
  .kpi-value{{display:block;font-family:'Cabinet Grotesk',sans-serif;font-weight:900;font-size:36px;letter-spacing:-0.03em;color:#F8FAFC}}
  .grid{{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}}
  .card{{background:#0E1420;border:1px solid #1A2333;border-radius:12px;padding:20px}}
  .card.span-2{{grid-column:span 2}}
  .card header{{margin-bottom:8px}}
  .card h3{{font-family:'Cabinet Grotesk',sans-serif;font-size:16px;margin:0 0 4px;color:#F8FAFC;font-weight:700}}
  .card p{{margin:0;color:#94A3B8;font-size:12px}}
  .chart-host{{width:100%;min-height:340px}}
  footer{{text-align:right;margin-top:24px;color:#475569;font-size:11px;letter-spacing:0.16em;text-transform:uppercase}}
  @media(max-width:780px){{.grid{{grid-template-columns:1fr}}.card.span-2{{grid-column:span 1}}}}
</style></head>
<body>
  <header class="top">
    <h1>{d.title}</h1>
    <p>{d.subtitle}</p>
  </header>
  <div class="kpis">{kpi_blocks}</div>
  <div class="grid">{''.join(chart_blocks)}</div>
  <footer>Generated by DashAI · {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · provider: {d.provider}</footer>
</body></html>"""
    return HTMLResponse(content=page, headers={"Content-Disposition": f'attachment; filename="{d.title.replace(" ", "_")}.html"'})


# ---------- Sample dataset ----------

@api.post("/sample/{name}", response_model=DatasetResponse)
async def load_sample(name: str) -> DatasetResponse:
    df = _build_sample(name)
    if df is None:
        raise HTTPException(status_code=404, detail="Unknown sample")
    profile = profile_dataframe(df, f"{name}_sample.csv")
    dataset_id = str(uuid.uuid4())
    _store(dataset_id, df, profile)
    return DatasetResponse(
        id=dataset_id,
        filename=profile["filename"],
        rows=profile["rows"],
        cols=profile["cols"],
        columns=profile["columns"],
        preview=profile["preview"],
        uploaded_at=DATASETS[dataset_id]["uploaded_at"],
    )


def _build_sample(name: str) -> pd.DataFrame | None:
    import numpy as np
    if name == "sales":
        rs = np.random.default_rng(7)
        months = pd.date_range("2024-01-01", periods=24, freq="MS")
        products = ["Aurora", "Blaze", "Cipher", "Drift", "Echo"]
        regions = ["NA", "EU", "APAC", "LATAM"]
        rows = []
        for m in months:
            for p in products:
                for r in regions:
                    base = {"Aurora": 12000, "Blaze": 8500, "Cipher": 14000, "Drift": 6500, "Echo": 9500}[p]
                    season = 1 + 0.3 * np.sin((m.month - 1) / 12 * 2 * np.pi)
                    region_mult = {"NA": 1.4, "EU": 1.1, "APAC": 1.0, "LATAM": 0.7}[r]
                    revenue = float(rs.normal(base, base * 0.18) * season * region_mult)
                    units = int(max(1, revenue / rs.uniform(120, 220)))
                    rows.append({
                        "date": m,
                        "product": p,
                        "region": r,
                        "revenue": round(revenue, 2),
                        "units": units,
                        "discount_pct": round(float(rs.uniform(0, 0.25)), 3),
                    })
        return pd.DataFrame(rows)
    if name == "marketing":
        rs = np.random.default_rng(12)
        channels = ["Search", "Social", "Email", "Display", "Affiliate", "Direct"]
        n = 600
        df = pd.DataFrame({
            "channel": rs.choice(channels, n),
            "campaign": [f"CMP-{i:04d}" for i in range(n)],
            "spend": rs.uniform(200, 5500, n).round(2),
            "impressions": rs.integers(2000, 250000, n),
            "clicks": rs.integers(40, 9000, n),
            "conversions": rs.integers(1, 320, n),
            "country": rs.choice(["US","UK","DE","FR","IN","BR","JP","AU"], n),
        })
        df["ctr"] = (df["clicks"] / df["impressions"]).round(4)
        df["cpa"] = (df["spend"] / df["conversions"]).round(2)
        return df
    return None


# ---------- App init ----------

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown() -> None:
    mongo_client.close()
