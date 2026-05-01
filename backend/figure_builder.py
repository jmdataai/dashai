"""
figure_builder.py — Plotly figure building with pandas.
Returns JSON-serializable figure dicts. Frontend renders them as-is.
"""
from __future__ import annotations
import math
from typing import Any

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

# Vibrant data palette — distinct colors for chart readability
PALETTE = ["#4468B0","#22d3ee","#10b981","#f59e0b","#a78bfa",
           "#f87171","#ec4899","#14b8a6","#f97316","#84cc16"]

# JM Data brand layout for all charts
JM_FONT = "Plus Jakarta Sans, Space Grotesk, system-ui, sans-serif"

DARK_LAYOUT = dict(
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(0,0,0,0)",
    font=dict(family=JM_FONT, color="#92A0BA", size=11),
    colorway=PALETTE,
    margin=dict(l=54, r=24, t=38, b=54),
    xaxis=dict(
        gridcolor="rgba(68,104,176,0.1)",
        linecolor="rgba(68,104,176,0.15)",
        zerolinecolor="rgba(68,104,176,0.08)",
        tickfont=dict(family=JM_FONT, color="#4a5878", size=10),
        zeroline=False,
    ),
    yaxis=dict(
        gridcolor="rgba(68,104,176,0.1)",
        linecolor="rgba(68,104,176,0.15)",
        zerolinecolor="rgba(68,104,176,0.08)",
        tickfont=dict(family=JM_FONT, color="#4a5878", size=10),
        zeroline=False,
    ),
    legend=dict(
        bgcolor="rgba(0,0,0,0)",
        font=dict(family=JM_FONT, color="#92A0BA", size=10),
        orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1,
    ),
    hoverlabel=dict(
        bgcolor="#141B34",
        bordercolor="#4468B0",
        font=dict(family=JM_FONT, color="#F7F8FB", size=12),
    ),
)


def _style(fig: go.Figure) -> go.Figure:
    fig.update_layout(**DARK_LAYOUT)
    return fig


def _has(df: pd.DataFrame, *cols) -> bool:
    return all(c is not None and str(c) in df.columns for c in cols)


def _agg(df: pd.DataFrame, x: str, y: str, agg: str, color=None) -> pd.DataFrame:
    grp = [x] + ([color] if color and color in df.columns and color != x else [])
    if agg == "count":
        return df.groupby(grp).size().reset_index(name=y)
    if agg in ("sum", "mean", "max", "min"):
        return df.groupby(grp)[y].agg(agg).reset_index()
    return df[list(dict.fromkeys(grp + [y]))].copy()


def _clean(obj: Any) -> Any:
    """Make any Python/numpy/pandas object JSON-serializable."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return _clean(obj.tolist())
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        v = float(obj)
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, bool):
        return obj
    return obj


def _to_dict(fig: go.Figure) -> dict[str, Any]:
    return _clean(fig.to_dict())


# ════════════════════════════════════════════════════════════════
# PUBLIC ENTRY
# ════════════════════════════════════════════════════════════════

def build_chart(spec: dict[str, Any], df: pd.DataFrame) -> dict[str, Any] | None:
    t     = (spec.get("type") or "bar").lower().strip()
    x     = spec.get("x")
    y     = spec.get("y")
    color = spec.get("color")
    z     = spec.get("z")
    agg   = spec.get("agg") or "sum"

    # Convert bool columns to strings for categorical use
    for col in [x, y, color, z]:
        if col and col in df.columns and pd.api.types.is_bool_dtype(df[col]):
            df = df.copy()
            df[col] = df[col].map({True: "Yes", False: "No"})

    anim = spec.get("animation_frame")

    try:
        if t == "bar":                    return _bar(df, x, y, color, agg)
        if t in ("line", "area"):         return _line(df, x, y, color, agg, area=(t == "area"))
        if t == "scatter":                return _scatter(df, x, y, color)
        if t in ("pie", "donut"):         return _pie(df, x, y, agg)
        if t == "histogram":              return _histogram(df, x, color)
        if t == "box":                    return _box(df, x, y)
        if t == "heatmap":               return _heatmap(df, x, y, z, agg)
        if t == "treemap":               return _treemap(df, x, y, agg)
        if t in ("scatter3d","scatter_3d","3d_scatter"): return _scatter3d(df, x, y, z, color)
        if t in ("surface3d","surface_3d","3d_surface"):  return _surface3d(df, x, y, z, agg)
        if t == "animated_bar":           return _animated_bar(df, x, y, color, anim, agg)
        if t == "animated_scatter":       return _animated_scatter(df, x, y, color, anim)
    except Exception as e:
        import logging
        logging.getLogger("dashai").warning(f"build_chart({t}) error: {e}")
    return None


# ── Fallback chain: never leaves an empty slot ──────────────────────────────
_FALLBACK_CHAINS: dict[str, list[str]] = {
    # 3D → 2D equivalents
    "scatter3d":       ["scatter", "bar"],
    "scatter_3d":      ["scatter", "bar"],
    "3d_scatter":      ["scatter", "bar"],
    "surface3d":       ["heatmap", "bar"],
    "surface_3d":      ["heatmap", "bar"],
    "3d_surface":      ["heatmap", "bar"],
    # Animated → static equivalents
    "animated_bar":    ["bar", "area"],
    "animated_scatter":["scatter", "bar"],
    # Other complex → simple
    "heatmap":         ["bar", "histogram"],
    "treemap":         ["bar", "donut"],
    "box":             ["histogram", "bar"],
    "surface":         ["heatmap", "bar"],
}


def build_chart_with_fallback(spec: dict, df) -> tuple[dict | None, str]:
    """
    Try the requested chart type. If it fails or returns None, try simpler
    fallback types in order. Returns (figure_dict, actual_type_used).

    Guarantees no empty slots — every spec either renders something or
    returns (None, "") which the caller then skips rather than showing blank.
    """
    import logging
    log = logging.getLogger("dashai")

    original_type = (spec.get("type") or "bar").lower().strip()

    # Try the original type first
    fig = build_chart(spec, df)
    if fig:
        return fig, original_type

    # If the original failed, walk the fallback chain
    fallback_types = _FALLBACK_CHAINS.get(original_type, ["bar", "histogram"])
    for fb_type in fallback_types:
        try:
            fb_spec = dict(spec)           # shallow copy so we don't mutate
            fb_spec["type"] = fb_type
            # animated_frame is irrelevant for static fallbacks — remove it
            fb_spec.pop("animation_frame", None)
            # For fallbacks from 3D: use x as x, y or z as y
            if fb_type in ("scatter", "bar", "area", "histogram") and not fb_spec.get("y"):
                fb_spec["y"] = spec.get("z") or spec.get("y")
            fig = build_chart(fb_spec, df)
            if fig:
                log.info(f"[fallback] {original_type} → {fb_type} succeeded")
                return fig, f"{fb_type}"
        except Exception as e:
            log.debug(f"[fallback] {fb_type} also failed: {e}")

    # Nothing worked — last resort: bar chart of first available columns
    try:
        num_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        cat_cols = [c for c in df.columns if df[c].dtype == object and df[c].nunique() < 30]
        if cat_cols and num_cols:
            last_spec = {"type":"bar","x":cat_cols[0],"y":num_cols[0],"agg":"mean"}
            fig = build_chart(last_spec, df)
            if fig:
                log.info(f"[fallback] last-resort bar chart succeeded for {original_type}")
                return fig, "bar"
    except Exception:
        pass

    log.warning(f"[fallback] all fallbacks failed for type={original_type} — chart slot dropped")
    return None, ""


def _bar(df, x, y, color, agg):
    if not _has(df, x): return None
    if y and _has(df, y) and pd.api.types.is_numeric_dtype(df[y]):
        sub = _agg(df, x, y, agg, color).sort_values(y, ascending=False).head(25)
        col_arg = color if color and color in sub.columns else None
        fig = px.bar(sub, x=x, y=y, color=col_arg, color_discrete_sequence=PALETTE,
                     barmode="group" if col_arg else "relative")
    else:
        sub = df[x].value_counts().reset_index()
        sub.columns = [x, "count"]
        sub = sub.head(25)
        fig = px.bar(sub, x=x, y="count", color_discrete_sequence=PALETTE)
    fig.update_traces(marker_line_width=0)
    fig.update_layout(xaxis_tickangle=-35)
    return _to_dict(_style(fig))


def _line(df, x, y, color, agg, area=False):
    if not _has(df, x, y): return None
    sub = df.copy()
    # Attempt datetime parse without deprecated errors="ignore"
    try:
        converted = pd.to_datetime(sub[x], format="mixed")
        sub = sub.copy()
        sub[x] = converted
    except Exception:
        pass  # leave column as-is if not parseable
    if agg in ("sum", "mean", "count", "max", "min"):
        sub = _agg(sub, x, y, agg, color)
    sub = sub.sort_values(x)
    col_arg = color if color and color in sub.columns else None
    if area:
        fig = px.area(sub, x=x, y=y, color=col_arg, color_discrete_sequence=PALETTE)
    else:
        fig = px.line(sub, x=x, y=y, color=col_arg, color_discrete_sequence=PALETTE)
    fig.update_traces(line=dict(width=2.5))
    return _to_dict(_style(fig))


def _scatter(df, x, y, color):
    if not _has(df, x, y): return None
    sub = df.dropna(subset=[x, y]).head(3000)
    col_arg = color if color and color in sub.columns else None
    fig = px.scatter(sub, x=x, y=y, color=col_arg, color_discrete_sequence=PALETTE)
    fig.update_traces(marker=dict(opacity=0.7, size=6, line=dict(width=0)))
    return _to_dict(_style(fig))


def _pie(df, x, y, agg):
    if not _has(df, x): return None
    if y and _has(df, y) and pd.api.types.is_numeric_dtype(df[y]):
        sub = df.groupby(x)[y].agg(agg if agg in ("sum","mean") else "sum").reset_index()
    else:
        sub = df[x].value_counts().reset_index()
        sub.columns = [x, "count"]
        y = "count"
    sub = sub.sort_values(y, ascending=False).head(10)
    fig = px.pie(sub, names=x, values=y, hole=0.52, color_discrete_sequence=PALETTE)
    fig.update_traces(textinfo="percent+label",
                      marker=dict(line=dict(color="#080d18", width=2)))
    return _to_dict(_style(fig))


def _histogram(df, x, color):
    if not _has(df, x): return None
    col_arg = color if color and color in df.columns else None
    fig = px.histogram(df, x=x, color=col_arg, color_discrete_sequence=PALETTE, nbins=30)
    fig.update_traces(marker_line_width=0, opacity=0.88)
    return _to_dict(_style(fig))


def _box(df, x, y):
    if y and _has(df, y):
        col_arg = x if x and _has(df, x) else None
        fig = px.box(df, x=col_arg, y=y, color=col_arg, color_discrete_sequence=PALETTE)
    elif x and _has(df, x):
        fig = px.box(df, y=x, color_discrete_sequence=PALETTE)
    else:
        return None
    return _to_dict(_style(fig))


def _heatmap(df, x, y, z, agg):
    if not _has(df, x, y): return None
    if z and _has(df, z) and pd.api.types.is_numeric_dtype(df[z]):
        pivot = df.pivot_table(index=y, columns=x, values=z,
                               aggfunc=agg if agg in ("sum","mean","count","max","min") else "mean")
    else:
        pivot = pd.crosstab(df[y], df[x])
    pivot = pivot.fillna(0)
    fig = go.Figure(data=go.Heatmap(
        z=pivot.values.tolist(),
        x=[str(c) for c in pivot.columns],
        y=[str(i) for i in pivot.index],
        colorscale=[[0,"#080d18"],[0.5,"#1e40af"],[1,"#22d3ee"]],
        hoverongaps=False,
    ))
    return _to_dict(_style(fig))


def _treemap(df, x, y, agg):
    if not _has(df, x): return None
    if y and _has(df, y) and pd.api.types.is_numeric_dtype(df[y]):
        sub = df.groupby(x)[y].agg(agg if agg in ("sum","mean") else "sum").reset_index()
    else:
        sub = df[x].value_counts().reset_index()
        sub.columns = [x, "count"]
        y = "count"
    sub = sub[sub[y] > 0]
    fig = px.treemap(sub, path=[x], values=y, color_discrete_sequence=PALETTE)
    fig.update_traces(marker=dict(line=dict(color="#080d18", width=1.5)))
    return _to_dict(_style(fig))


def _scatter3d(df, x, y, z, color):
    if not _has(df, x, y, z): return None
    sub = df.dropna(subset=[x, y, z]).head(2000)
    col_arg = color if color and color in sub.columns else None
    fig = px.scatter_3d(sub, x=x, y=y, z=z, color=col_arg, color_discrete_sequence=PALETTE)
    fig.update_traces(marker=dict(size=4, opacity=0.8))
    fig.update_layout(scene=dict(
        xaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.06)", color="#607090"),
        yaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.06)", color="#607090"),
        zaxis=dict(backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.06)", color="#607090"),
    ))
    return _to_dict(_style(fig))


def _surface3d(df, x, y, z, agg):
    """3D surface: two categoricals on x/y, numeric on z. Pivots into a matrix."""
    if not _has(df, x, y, z): return None
    if not pd.api.types.is_numeric_dtype(df[z]): return None
    try:
        pivot = df.pivot_table(index=y, columns=x, values=z,
                               aggfunc=agg if agg in ("sum","mean","count") else "mean")
        pivot = pivot.fillna(0)
        fig = go.Figure(data=[go.Surface(
            z=pivot.values.tolist(),
            x=[str(c) for c in pivot.columns],
            y=[str(i) for i in pivot.index],
            colorscale=[[0,"#060a14"],[0.25,"#1e40af"],[0.5,"#4f6df5"],[0.75,"#00d4e8"],[1,"#00c48c"]],
            contours=dict(z=dict(show=True, usecolormap=True, highlightcolor="#fff", project_z=True)),
        )])
        fig.update_layout(
            scene=dict(
                xaxis=dict(title=x, backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.06)", color="#607090"),
                yaxis=dict(title=y, backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.06)", color="#607090"),
                zaxis=dict(title=z, backgroundcolor="rgba(0,0,0,0)", gridcolor="rgba(255,255,255,0.06)", color="#607090"),
                bgcolor="rgba(0,0,0,0)",
            ),
        )
        return _to_dict(_style(fig))
    except Exception:
        return None


def _animated_bar(df, x, y, color, anim, agg):
    """Animated bar chart — animation_frame controls which frame to show."""
    if not _has(df, x, y) or not anim or not _has(df, anim): return None
    if not pd.api.types.is_numeric_dtype(df[y]): return None
    try:
        sub = _agg(df, x, y, agg if agg in ("sum","mean","count") else "sum")
        # Need the animation frame column too
        grp_cols = [anim, x]
        if color and color in df.columns: grp_cols.append(color)
        sub = df.groupby(grp_cols)[y].agg(agg if agg in ("sum","mean","count") else "sum").reset_index()
        sub = sub.sort_values([anim, y], ascending=[True, False])
        # Limit categories per frame
        frames = sub[anim].unique()
        if len(frames) < 2 or len(frames) > 30: return None
        fig = px.bar(sub, x=x, y=y,
                     color=color if color and color in sub.columns else x,
                     animation_frame=anim,
                     color_discrete_sequence=PALETTE,
                     barmode="group")
        fig.update_traces(marker_line_width=0)
        fig.update_layout(
            xaxis_tickangle=-30,
            updatemenus=[dict(type="buttons", showactive=False, x=0.05, y=-0.12,
                              buttons=[dict(label="▶ Play", method="animate",
                                           args=[None, {"frame":{"duration":600,"redraw":True},"fromcurrent":True}]),
                                       dict(label="⏸", method="animate",
                                           args=[[None], {"frame":{"duration":0,"redraw":False},"mode":"immediate"}])])],
            sliders=[dict(currentvalue={"prefix":f"{anim}: "}, pad={"t":40})],
        )
        return _to_dict(_style(fig))
    except Exception:
        return None


def _animated_scatter(df, x, y, color, anim):
    """Animated scatter — dots move across frames."""
    if not _has(df, x, y) or not anim or not _has(df, anim): return None
    if not pd.api.types.is_numeric_dtype(df[x]) or not pd.api.types.is_numeric_dtype(df[y]):
        return None
    try:
        sub = df.dropna(subset=[x, y, anim]).head(3000)
        frames = sub[anim].unique()
        if len(frames) < 2 or len(frames) > 30: return None
        col_arg = color if color and color in sub.columns else None
        fig = px.scatter(sub, x=x, y=y,
                         color=col_arg,
                         animation_frame=anim,
                         color_discrete_sequence=PALETTE,
                         size_max=10)
        fig.update_traces(marker=dict(size=8, opacity=0.75, line=dict(width=0)))
        fig.update_layout(
            updatemenus=[dict(type="buttons", showactive=False, x=0.05, y=-0.12,
                              buttons=[dict(label="▶ Play", method="animate",
                                           args=[None, {"frame":{"duration":500,"redraw":True},"fromcurrent":True}]),
                                       dict(label="⏸", method="animate",
                                           args=[[None], {"frame":{"duration":0,"redraw":False},"mode":"immediate"}])])],
            sliders=[dict(currentvalue={"prefix":f"{anim}: "}, pad={"t":40})],
        )
        return _to_dict(_style(fig))
    except Exception:
        return None

def compute_kpi(spec: dict, df: pd.DataFrame) -> dict:
    label  = spec.get("label", "VALUE")
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
            s = pd.to_numeric(df[column], errors="coerce").dropna()
            if   metric == "sum":  value = float(s.sum())
            elif metric == "mean": value = float(s.mean())
            elif metric == "max":  value = float(s.max())
            elif metric == "min":  value = float(s.min())
    except:
        pass
    return {"label": str(label)[:40], "value": value, "format": fmt,
            "column": column, "metric": metric}


def format_kpi_value(value, fmt: str) -> str:
    try:
        v = float(value)
        if fmt == "currency":
            if abs(v) >= 1e9: return f"${v/1e9:.2f}B"
            if abs(v) >= 1e6: return f"${v/1e6:.2f}M"
            if abs(v) >= 1e3: return f"${v/1e3:.1f}K"
            return f"${v:,.0f}"
        if fmt == "percent":
            return f"{v:.1f}%"
        if abs(v) >= 1e6: return f"{v/1e6:.2f}M"
        if abs(v) >= 1e3: return f"{v/1e3:.1f}K"
        if v == int(v):   return f"{int(v):,}"
        return f"{v:,.2f}"
    except:
        return str(value)
