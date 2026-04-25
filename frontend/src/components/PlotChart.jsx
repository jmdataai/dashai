import React from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";

const Plot = createPlotlyComponent(Plotly);

export default function PlotChart({ figure, minHeight = 320 }) {
  if (!figure || !figure.data) return null;

  const layout = {
    ...(figure.layout || {}),
    autosize: true,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: figure.layout?.margin || { l: 48, r: 24, t: 24, b: 48 },
    font: figure.layout?.font || {
      family: "IBM Plex Sans, sans-serif",
      color: "#F8FAFC",
      size: 12,
    },
  };

  return (
    <div style={{ width: "100%", minHeight }}>
      <Plot
        data={figure.data}
        layout={layout}
        useResizeHandler
        style={{ width: "100%", height: minHeight }}
        config={{
          displayModeBar: false,
          responsive: true,
        }}
      />
    </div>
  );
}
