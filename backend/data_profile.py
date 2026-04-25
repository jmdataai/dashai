"""Dataset ingestion + profiling."""
from __future__ import annotations

import io
import math
from typing import Any

import numpy as np
import pandas as pd


def read_dataset(filename: str, raw: bytes) -> pd.DataFrame:
    name = filename.lower()
    if name.endswith(".csv") or name.endswith(".tsv") or name.endswith(".txt"):
        sep = "\t" if name.endswith(".tsv") else ","
        try:
            return pd.read_csv(io.BytesIO(raw), sep=sep)
        except UnicodeDecodeError:
            return pd.read_csv(io.BytesIO(raw), sep=sep, encoding="latin-1")
    if name.endswith(".xlsx") or name.endswith(".xls"):
        return pd.read_excel(io.BytesIO(raw))
    # try csv as default
    try:
        return pd.read_csv(io.BytesIO(raw))
    except Exception as e:
        raise ValueError(f"Unsupported file type: {filename}") from e


def _semantic(s: pd.Series) -> str:
    if pd.api.types.is_datetime64_any_dtype(s):
        return "datetime"
    if pd.api.types.is_bool_dtype(s):
        return "boolean"
    if pd.api.types.is_numeric_dtype(s):
        return "numeric"
    # Try parse a sample as datetime
    sample = s.dropna().astype(str).head(50)
    if len(sample) > 0:
        try:
            parsed = pd.to_datetime(sample, errors="raise", infer_datetime_format=True)
            if parsed.notna().mean() > 0.85:
                return "datetime"
        except Exception:
            pass
    return "categorical"


def _safe_float(v: Any) -> float | None:
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except Exception:
        return None


def profile_dataframe(df: pd.DataFrame, filename: str) -> dict[str, Any]:
    # Coerce datetime-looking columns
    for col in df.columns:
        if df[col].dtype == "object":
            sample = df[col].dropna().astype(str).head(30)
            if len(sample) > 0:
                try:
                    parsed = pd.to_datetime(sample, errors="raise", infer_datetime_format=True)
                    if parsed.notna().mean() > 0.85:
                        df[col] = pd.to_datetime(df[col], errors="coerce")
                except Exception:
                    pass

    columns = []
    for col in df.columns:
        s = df[col]
        sem = _semantic(s)
        info: dict[str, Any] = {
            "name": str(col),
            "dtype": str(s.dtype),
            "semantic": sem,
            "n_unique": int(s.nunique(dropna=True)),
            "n_null": int(s.isna().sum()),
            "sample_values": [],
            "min": None,
            "max": None,
            "mean": None,
        }
        non_null = s.dropna()
        if sem == "numeric":
            info["min"] = _safe_float(non_null.min()) if len(non_null) else None
            info["max"] = _safe_float(non_null.max()) if len(non_null) else None
            info["mean"] = _safe_float(non_null.mean()) if len(non_null) else None
            info["sample_values"] = [_safe_float(v) for v in non_null.head(5).tolist()]
        elif sem == "datetime":
            if len(non_null):
                info["min"] = pd.Timestamp(non_null.min()).isoformat()
                info["max"] = pd.Timestamp(non_null.max()).isoformat()
            info["sample_values"] = [pd.Timestamp(v).isoformat() for v in non_null.head(5).tolist()]
        else:
            info["sample_values"] = [str(v)[:48] for v in non_null.head(5).tolist()]
        columns.append(info)

    preview_df = df.head(8).copy()
    for col in preview_df.columns:
        if pd.api.types.is_datetime64_any_dtype(preview_df[col]):
            preview_df[col] = preview_df[col].astype(str)
    preview = preview_df.replace({np.nan: None}).to_dict(orient="records")

    return {
        "filename": filename,
        "rows": int(df.shape[0]),
        "cols": int(df.shape[1]),
        "columns": columns,
        "preview": preview,
    }
