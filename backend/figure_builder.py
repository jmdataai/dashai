"""
figure_builder.py — Build Plotly figures server-side with pandas.

Returns plain dicts (JSON-serializable) of Plotly figures.
Handles aggregation, sorting, theming — frontend just renders.
"""
from __future__ import annotations
import math
from typing import Any
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

# ── Neon palette ──
PALETTE = ["#5b6ef5","#22d3ee","#10b981","#f59e0b","#a78bfa","#f87171","#ec4899","#14b8a6","#f97316","#84cc16"]

# ── Dark layout theme ──
LAYOUT = dict(
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(0,0,0,0)",
    font=dict(family="Sora, system-ui, sans-serif", color="#94a3b8", size=12),
    colorway=PALETTE,
    margin=dict(l=50, r=24, t=40, b=50),
    xaxis=dict(gridcolor="rgba(255,255,255,0.05)", linecolor="rgba(255,255,255,0.1)",
               tickfont=dict(color="#607090",size=10), zeroline=False),
    yaxis=dict(gridcolor="rgba(255,255,255,0.05)", linecolor="rgba(255,255,255,0.1)",
               tickfont=dict(color="#607090",size=10), zeroline=False),
    legend=dict(bgcolor="rgba(0,0,0,0)", font=dict(color="#607090",size=10),
                orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    hoverlabel=dict(bgcolor="#141e2e", bordercolor="#203050",
                    font=dict(color="#edf2f8",size=12)),
)


def _style(fig: go.Figure) -> go.Figure:
    fig.update_layout(**LAYOUT)
    return fig


def _has(df: pd.DataFrame, *cols: str | None) -> bool:
    return all(c is not None and c in df.columns for c in cols)


def _agg_df(df: pd.DataFrame, x: str, y: str, agg: str, color: str | None = None) -> pd.DataFrame:
    grp = [x] + ([color] if color and color != x and color in df.columns else [])
    if agg == "count":
        return df.groupby(grp).size().reset_index(name=y)
    if agg in ("sum","mean","max","min"):
        return df.groupby(grp)[y].agg(agg).reset_index()
    return df[grp + [y]].copy()


def _to_dict(fig: go.Figure) -> dict[str, Any]:
    """Convert figure to JSON-safe dict."""
    return _clean(fig.to_dict())


def _clean(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return _clean(obj.tolist())
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return None if math.isnan(v) else v
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    if isinstance(obj, float) and math.isnan(obj):
        return None
    return obj


# ════════════════════════════════════════════════════════════
# CHART BUILDERS
# ════════════════════════════════════════════════════════════

def build_chart(spec: dict[str, Any], df: pd.DataFrame) -> dict[str, Any] | None:
    t = (spec.get("type") or "bar").lower().strip()
    x, y = spec.get("x"), spec.get("y")
    color, z = spec.get("color"), spec.get("z")
    agg = spec.get("agg") or "sum"
    try:
        if t == "bar":        return _bar(df, x, y, color, agg)
        if t in ("line","area"): return _line(df, x, y, color, agg, area=(t=="area"))
        if t == "scatter":    return _scatter(df, x, y, color)
        if t in ("pie","donut"): return _pie(df, x, y, agg)
        if t == "histogram":  return _histogram(df, x, color)
        if t == "box":        return _box(df, x, y)
        if t == "heatmap":    return _heatmap(df, x, y, z, agg)
        if t == "treemap":    return _treemap(df, x, y, agg)
        if t in ("scatter3d","scatter_3d","3d_scatter"): return _scatter3d(df, x, y, z, color)
    except Exception as e:
        import logging
        logging.getLogger("dashai").warning(f"build_chart({t}) failed: {e}")
    return None


def _bar(df, x, y, color, agg):
    if not _has(df, x): return None
    if y and _has(df, y) and pd.api.types.is_numeric_dtype(df[y]):
        sub = _agg_df(df, x, y, agg, color).sort_values(y, ascending=False).head(20)
        fig = px.bar(sub, x=x, y=y, color=color if color and color in sub.columns else None, color_discrete_sequence=PALETTE)
    else:
        sub = df[x].value_counts().reset_index(); sub.columns = [x, "count"]
        sub = sub.head(20)
        fig = px.bar(sub, x=x, y="count", color_discrete_sequence=PALETTE)
    fig.update_traces(marker_line_width=0)
    return _to_dict(_style(fig))


def _line(df, x, y, color, agg, area=False):
    if not _has(df, x, y): return None
    sub = df.copy()
    try: sub[x] = pd.to_datetime(sub[x], errors="ignore")
    except: pass
    if agg in ("sum","mean","count","max","min"):
        sub = _agg_df(sub, x, y, agg, color)
    sub = sub.sort_values(x)
    if area:
        fig = px.area(sub, x=x, y=y, color=color if color and color in sub.columns else None, color_discrete_sequence=PALETTE)
    else:
        fig = px.line(sub, x=x, y=y, color=color if color and color in sub.columns else None, color_discrete_sequence=PALETTE)
    fig.update_traces(line=dict(width=2.5))
    return _to_dict(_style(fig))


def _scatter(df, x, y, color):
    if not _has(df, x, y): return None
    sub = df.dropna(subset=[x,y]).head(3000)
    fig = px.scatter(sub, x=x, y=y,
                     color=color if color and color in sub.columns else None,
                     color_discrete_sequence=PALETTE)
    fig.update_traces(marker=dict(opacity=0.7, size=6, line=dict(width=0)))
    return _to_dict(_style(fig))


def _pie(df, x, y, agg):
    if not _has(df, x): return None
    if y and _has(df, y) and pd.api.types.is_numeric_dtype(df[y]):
        sub = df.groupby(x)[y].agg(agg if agg in ("sum","mean") else "sum").reset_index()
    else:
        sub = df[x].value_counts().reset_index(); sub.columns = [x, "count"]; y = "count"
    sub = sub.sort_values(y, ascending=False).head(10)
    fig = px.pie(sub, names=x, values=y, hole=0.5, color_discrete_sequence=PALETTE)
    fig.update_traces(textinfo="percent", marker=dict(line=dict(color="#080d18", width=2)))
    return _to_dict(_style(fig))


def _histogram(df, x, color):
    if not _has(df, x): return None
    fig = px.histogram(df, x=x,
                       color=color if color and color in df.columns else None,
                       color_discrete_sequence=PALETTE, nbins=30)
    fig.update_traces(marker_line_width=0, opacity=0.88)
    return _to_dict(_style(fig))


def _box(df, x, y):
    if y and _has(df, y):
        fig = px.box(df, x=x if x and _has(df, x) else None, y=y,
                     color=x if x and _has(df, x) else None,
                     color_discrete_sequence=PALETTE)
    elif x and _has(df, x):
        fig = px.box(df, y=x, color_discrete_sequence=PALETTE)
    else:
        return None
    return _to_dict(_style(fig))


def _heatmap(df, x, y, z, agg):
    if not _has(df, x, y): return None
    if z and _has(df, z) and pd.api.types.is_numeric_dtype(df[z]):
        pivot = df.pivot_table(index=y, columns=x, values=z, aggfunc=agg if agg in ("sum","mean","count") else "mean")
    else:
        pivot = pd.crosstab(df[y], df[x])
    pivot = pivot.fillna(0)
    fig = go.Figure(data=go.Heatmap(
        z=pivot.values, x=list(pivot.columns), y=list(pivot.index),
        colorscale=[[0,"#080d18"],[0.5,"#2563eb"],[1,"#22d3ee"]],
        hoverongaps=False))
    return _to_dict(_style(fig))


def _treemap(df, x, y, agg):
    if not _has(df, x): return None
    if y and _has(df, y) and pd.api.types.is_numeric_dtype(df[y]):
        sub = df.groupby(x)[y].agg(agg if agg in ("sum","mean") else "sum").reset_index()
    else:
        sub = df[x].value_counts().reset_index(); sub.columns = [x, "count"]; y = "count"
    fig = px.treemap(sub, path=[x], values=y, color_discrete_sequence=PALETTE)
    return _to_dict(_style(fig))


def _scatter3d(df, x, y, z, color):
    if not _has(df, x, y, z): return None
    sub = df.dropna(subset=[x,y,z]).head(2000)
    fig = px.scatter_3d(sub, x=x, y=y, z=z,
                        color=color if color and color in sub.columns else None,
                        color_discrete_sequence=PALETTE)
    fig.update_traces(marker=dict(size=4, opacity=0.8))
    fig.update_layout(scene=dict(
        xaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.06)", color="#607090"),
        yaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.06)", color="#607090"),
        zaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.06)", color="#607090"),
    ))
    return _to_dict(_style(fig))


# ════════════════════════════════════════════════════════════
# KPI COMPUTATION
# ════════════════════════════════════════════════════════════

def compute_kpi(spec: dict[str, Any], df: pd.DataFrame) -> dict[str, Any]:
    label  = spec.get("label","VALUE")
    metric = (spec.get("metric") or "count").lower()
    column = spec.get("column")
    fmt    = spec.get("format") or "number"
    value  = 0
    try:
        if metric == "count" or column is None:
            value = int(len(df))
        elif metric == "count_distinct" and column in df.columns:
            value = int(df[column].nunique())
        elif column in df.columns and pd.api.types.is_numeric_dtype(df[column]):
            s = df[column].dropna()
            if   metric == "sum":  value = float(s.sum())
            elif metric == "mean": value = float(s.mean())
            elif metric == "max":  value = float(s.max())
            elif metric == "min":  value = float(s.min())
    except: pass
    return {"label": label[:40], "value": value, "format": fmt, "column": column, "metric": metric}


def format_kpi_value(value: float | int, fmt: str) -> str:
    try:
        if fmt == "currency":
            if abs(value)>=1e9: return f"${value/1e9:.2f}B"
            if abs(value)>=1e6: return f"${value/1e6:.2f}M"
            if abs(value)>=1e3: return f"${value/1e3:.1f}K"
            return f"${value:,.0f}"
        if fmt == "percent":
            return f"{value:.1f}%"
        v = float(value)
        if abs(v)>=1e6: return f"{v/1e6:.2f}M"
        if abs(v)>=1e3: return f"{v/1e3:.1f}K"
        if v == int(v): return f"{int(v):,}"
        return f"{v:,.2f}"
    except: return str(value)
