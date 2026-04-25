"""Convert AI chart specs + DataFrame into Plotly figure dicts (theme-styled)."""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

# Neon palette (matches design_guidelines.json)
NEON = ["#00E5FF", "#FF007F", "#E0FF00", "#00FF66", "#FF4500", "#A855F7", "#22D3EE", "#F472B6"]

DARK_LAYOUT = dict(
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(0,0,0,0)",
    font=dict(family="IBM Plex Sans, sans-serif", color="#F8FAFC", size=12),
    colorway=NEON,
    margin=dict(l=48, r=24, t=48, b=48),
    xaxis=dict(
        gridcolor="rgba(255,255,255,0.06)",
        zerolinecolor="rgba(255,255,255,0.08)",
        linecolor="rgba(255,255,255,0.18)",
        tickfont=dict(color="#94A3B8", size=11),
        title=dict(font=dict(color="#94A3B8", size=12)),
    ),
    yaxis=dict(
        gridcolor="rgba(255,255,255,0.06)",
        zerolinecolor="rgba(255,255,255,0.08)",
        linecolor="rgba(255,255,255,0.18)",
        tickfont=dict(color="#94A3B8", size=11),
        title=dict(font=dict(color="#94A3B8", size=12)),
    ),
    legend=dict(
        bgcolor="rgba(0,0,0,0)",
        font=dict(color="#94A3B8", size=11),
        orientation="h",
        yanchor="bottom",
        y=1.02,
        xanchor="right",
        x=1,
    ),
    hoverlabel=dict(
        bgcolor="#0E1420",
        bordercolor="#2DD4BF",
        font=dict(color="#F8FAFC", family="IBM Plex Sans"),
    ),
    title=dict(font=dict(color="#F8FAFC", size=15, family="Cabinet Grotesk")),
)


def _style(fig: go.Figure) -> go.Figure:
    fig.update_layout(**DARK_LAYOUT)
    return fig


def _has(df: pd.DataFrame, *cols: str | None) -> bool:
    return all(c is not None and c in df.columns for c in cols)


def _agg_df(df: pd.DataFrame, x: str, y: str, agg: str, color: str | None = None) -> pd.DataFrame:
    group_cols = [x] + ([color] if color and color != x else [])
    if agg in {"sum", "mean", "max", "min", "count"}:
        if agg == "count":
            out = df.groupby(group_cols).size().reset_index(name=y)
        else:
            out = df.groupby(group_cols)[y].agg(agg).reset_index()
    else:
        out = df[group_cols + [y]].copy()
    return out


def _fig_to_dict(fig: go.Figure) -> dict[str, Any]:
    d = fig.to_dict()
    # ensure JSON-serializable (numpy arrays -> lists)
    return _np_to_native(d)


def _np_to_native(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _np_to_native(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_np_to_native(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return _np_to_native(obj.tolist())
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return None if math.isnan(v) else v
    if isinstance(obj, (pd.Timestamp,)):
        return obj.isoformat()
    if isinstance(obj, float) and math.isnan(obj):
        return None
    return obj


# ---------- Chart builders ----------

def build_chart(spec: dict[str, Any], df: pd.DataFrame) -> dict[str, Any] | None:
    t = (spec.get("type") or "bar").lower()
    x = spec.get("x")
    y = spec.get("y")
    color = spec.get("color")
    z = spec.get("z")
    size = spec.get("size")
    agg = spec.get("agg") or "none"

    try:
        if t == "bar":
            return _bar(df, x, y, color, agg)
        if t in ("line", "area"):
            return _line(df, x, y, color, agg, area=(t == "area"))
        if t == "scatter":
            return _scatter(df, x, y, color, size)
        if t in ("pie", "donut"):
            return _pie(df, x, y, agg, donut=(t == "donut"))
        if t == "histogram":
            return _histogram(df, x, color)
        if t == "box":
            return _box(df, x, y)
        if t == "heatmap":
            return _heatmap(df, x, y, z, agg)
        if t == "treemap":
            return _treemap(df, x, y, agg)
        if t in ("scatter_3d", "3d_scatter"):
            return _scatter_3d(df, x, y, z, color)
    except Exception:
        return None
    return None


def _bar(df, x, y, color, agg):
    if not _has(df, x):
        return None
    if y is None or not _has(df, y):
        # fall back to count bar
        sub = df[x].value_counts().reset_index()
        sub.columns = [x, "count"]
        sub = sub.head(20)
        fig = px.bar(sub, x=x, y="count", color_discrete_sequence=NEON)
    else:
        sub = _agg_df(df, x, y, agg if agg != "none" else "sum", color)
        sub = sub.sort_values(y, ascending=False).head(20)
        fig = px.bar(sub, x=x, y=y, color=color if color in sub.columns else None, color_discrete_sequence=NEON)
    fig.update_traces(marker_line_width=0, marker=dict(cornerradius=4) if False else None)
    return _fig_to_dict(_style(fig))


def _line(df, x, y, color, agg, area=False):
    if not _has(df, x, y):
        return None
    sub = df.copy()
    # Attempt datetime parse
    try:
        sub[x] = pd.to_datetime(sub[x], errors="ignore")
    except Exception:
        pass
    if agg in {"sum", "mean", "count", "max", "min"}:
        sub = _agg_df(sub, x, y, agg, color)
    sub = sub.sort_values(x)
    if area:
        fig = px.area(sub, x=x, y=y, color=color if color in sub.columns else None, color_discrete_sequence=NEON)
        fig.update_traces(line=dict(width=2))
    else:
        fig = px.line(sub, x=x, y=y, color=color if color in sub.columns else None, color_discrete_sequence=NEON)
        fig.update_traces(line=dict(width=2.5))
    return _fig_to_dict(_style(fig))


def _scatter(df, x, y, color, size):
    if not _has(df, x, y):
        return None
    sub = df.dropna(subset=[x, y]).head(2500)
    kwargs = {"color_discrete_sequence": NEON}
    if color and color in sub.columns:
        kwargs["color"] = color
    if size and size in sub.columns and pd.api.types.is_numeric_dtype(sub[size]):
        kwargs["size"] = size
        kwargs["size_max"] = 20
    fig = px.scatter(sub, x=x, y=y, **kwargs)
    fig.update_traces(marker=dict(line=dict(width=0), opacity=0.85))
    return _fig_to_dict(_style(fig))


def _pie(df, x, y, agg, donut=True):
    if not _has(df, x):
        return None
    if y and _has(df, y) and pd.api.types.is_numeric_dtype(df[y]):
        sub = df.groupby(x)[y].agg(agg if agg in {"sum", "mean"} else "sum").reset_index()
    else:
        sub = df[x].value_counts().reset_index()
        sub.columns = [x, "count"]
        y = "count"
    sub = sub.sort_values(y, ascending=False).head(8)
    fig = px.pie(sub, names=x, values=y, hole=0.55 if donut else 0.0, color_discrete_sequence=NEON)
    fig.update_traces(textinfo="percent", textfont=dict(color="#04070D", size=11), marker=dict(line=dict(color="#04070D", width=2)))
    return _fig_to_dict(_style(fig))


def _histogram(df, x, color):
    if not _has(df, x):
        return None
    fig = px.histogram(df, x=x, color=color if color and color in df.columns else None, color_discrete_sequence=NEON, nbins=30)
    fig.update_traces(marker_line_width=0, opacity=0.85)
    return _fig_to_dict(_style(fig))


def _box(df, x, y):
    if y and _has(df, y):
        if x and _has(df, x):
            fig = px.box(df, x=x, y=y, color=x, color_discrete_sequence=NEON)
        else:
            fig = px.box(df, y=y, color_discrete_sequence=NEON)
    elif x and _has(df, x):
        fig = px.box(df, y=x, color_discrete_sequence=NEON)
    else:
        return None
    return _fig_to_dict(_style(fig))


def _heatmap(df, x, y, z, agg):
    if not _has(df, x, y):
        return None
    if z and _has(df, z) and pd.api.types.is_numeric_dtype(df[z]):
        pivot = df.pivot_table(index=y, columns=x, values=z, aggfunc=agg if agg in {"sum", "mean", "count"} else "mean")
    else:
        pivot = pd.crosstab(df[y], df[x])
    pivot = pivot.fillna(0)
    fig = go.Figure(
        data=go.Heatmap(
            z=pivot.values,
            x=list(pivot.columns),
            y=list(pivot.index),
            colorscale=[[0, "#04070D"], [0.5, "#0e7490"], [1, "#00E5FF"]],
            hoverongaps=False,
        )
    )
    return _fig_to_dict(_style(fig))


def _treemap(df, x, y, agg):
    if not _has(df, x):
        return None
    if y and _has(df, y) and pd.api.types.is_numeric_dtype(df[y]):
        sub = df.groupby(x)[y].agg(agg if agg in {"sum", "mean"} else "sum").reset_index()
    else:
        sub = df[x].value_counts().reset_index()
        sub.columns = [x, "count"]
        y = "count"
    fig = px.treemap(sub, path=[x], values=y, color_discrete_sequence=NEON)
    fig.update_traces(marker=dict(line=dict(color="#04070D", width=2)))
    return _fig_to_dict(_style(fig))


def _scatter_3d(df, x, y, z, color):
    if not _has(df, x, y, z):
        return None
    sub = df.dropna(subset=[x, y, z]).head(2000)
    fig = px.scatter_3d(sub, x=x, y=y, z=z, color=color if color in sub.columns else None, color_discrete_sequence=NEON)
    fig.update_traces(marker=dict(size=4, opacity=0.85))
    fig.update_layout(scene=dict(
        xaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.08)", color="#94A3B8"),
        yaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.08)", color="#94A3B8"),
        zaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.08)", color="#94A3B8"),
    ))
    return _fig_to_dict(_style(fig))


# ---------- KPI computation ----------

def compute_kpi(spec: dict[str, Any], df: pd.DataFrame) -> dict[str, Any]:
    label = spec.get("label", "VALUE")
    metric = (spec.get("metric") or "count").lower()
    column = spec.get("column")
    fmt = spec.get("format") or "number"
    value: float | int | None = None
    try:
        if metric == "count" or column is None:
            value = int(len(df))
        elif metric == "count_distinct" and column in df.columns:
            value = int(df[column].nunique())
        elif column in df.columns and pd.api.types.is_numeric_dtype(df[column]):
            series = df[column].dropna()
            if metric == "sum":
                value = float(series.sum())
            elif metric == "mean":
                value = float(series.mean())
            elif metric == "max":
                value = float(series.max())
            elif metric == "min":
                value = float(series.min())
    except Exception:
        value = None
    if value is None:
        value = 0
    return {"label": label[:40], "value": value, "format": fmt, "column": column, "metric": metric}
