import React, { useEffect, useRef } from 'react';

/* ── JM Data brand colours applied to every Plotly chart ── */
const JM_FONT = 'Plus Jakarta Sans, Space Grotesk, system-ui, sans-serif';

const DARK_LAYOUT = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor:  'rgba(0,0,0,0)',
  font: { color: '#92A0BA', family: JM_FONT, size: 11 },
  xaxis: {
    gridcolor: 'rgba(68,104,176,0.1)',
    linecolor: 'rgba(68,104,176,0.15)',
    tickfont:  { color: '#4a5878', family: JM_FONT, size: 10 },
    zeroline:  false,
  },
  yaxis: {
    gridcolor: 'rgba(68,104,176,0.1)',
    linecolor: 'rgba(68,104,176,0.15)',
    tickfont:  { color: '#4a5878', family: JM_FONT, size: 10 },
    zeroline:  false,
  },
  hoverlabel: {
    bgcolor:     '#141B34',
    bordercolor: '#4468B0',
    font:        { color: '#F7F8FB', family: JM_FONT, size: 12 },
  },
  legend: {
    bgcolor: 'rgba(0,0,0,0)',
    font:    { color: '#92A0BA', family: JM_FONT, size: 11 },
    orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'right', x: 1,
  },
  margin: { t: 10, r: 18, b: 48, l: 54 },
};

/* Slider / animation controls styled to JM brand */
function applyAnimationStyles(layout) {
  if (layout.sliders) {
    layout.sliders = layout.sliders.map(s => Object.assign({}, s, {
      font:         { color: '#92A0BA', family: JM_FONT, size: 10 },
      currentvalue: Object.assign({}, s.currentvalue, { font: { color: '#F7F8FB', family: JM_FONT, size: 12 } }),
      bgcolor:      '#141B34',
      bordercolor:  '#4468B0',
      activebgcolor:'#1e2b4a',
    }));
  }
  if (layout.updatemenus) {
    layout.updatemenus = layout.updatemenus.map(u => Object.assign({}, u, {
      bgcolor:     '#141B34',
      bordercolor: '#4468B0',
      font:        { color: '#F7F8FB', family: JM_FONT, size: 11 },
    }));
  }
  layout.margin = Object.assign({}, layout.margin, { b: 88 });
}

export default function PlotlyChart({ chart, height = '360px' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !chart?.figure) return;
    const Plotly = window.Plotly;
    if (!Plotly) return;

    const layout = Object.assign({}, DARK_LAYOUT, chart.figure.layout || {}, {
      autosize:       true,
      paper_bgcolor:  'rgba(0,0,0,0)',
      plot_bgcolor:   'rgba(0,0,0,0)',
      font:           Object.assign({}, DARK_LAYOUT.font, (chart.figure.layout?.font || {})),
      hoverlabel:     Object.assign({}, DARK_LAYOUT.hoverlabel, (chart.figure.layout?.hoverlabel || {})),
    });

    /* ── 3D scene styling ── */
    const is3D = (chart.figure.data || []).some(t => ['scatter3d', 'surface', 'mesh3d'].includes(t.type));
    if (is3D) {
      const axStyle = {
        backgroundcolor: '#0C162A',
        gridcolor:       'rgba(68,104,176,0.12)',
        color:           '#92A0BA',
        showbackground:  true,
        tickfont:        { family: JM_FONT, color: '#92A0BA', size: 10 },
      };
      layout.scene = Object.assign({}, layout.scene || {}, {
        bgcolor: '#0C162A',
        xaxis: axStyle, yaxis: axStyle, zaxis: axStyle,
      });
      ref.current.style.height = '500px';
    }

    /* ── Animated charts ── */
    const isAnimated = !!(chart.figure.frames?.length);
    if (isAnimated) {
      applyAnimationStyles(layout);
      ref.current.style.height = '520px';
    }

    const config = {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d', 'autoScale2d'],
      toImageButtonOptions: { format: 'png', scale: 2, filename: chart.title || 'chart' },
    };

    const render = async () => {
      try {
        if (isAnimated && chart.figure.frames) {
          await Plotly.newPlot(ref.current, chart.figure.data || [], layout, config);
          await Plotly.addFrames(ref.current, chart.figure.frames);
        } else {
          Plotly.newPlot(ref.current, chart.figure.data || [], layout, config);
        }
      } catch (e) {
        console.error('Plotly render error:', e);
      }
    };
    render();

    return () => { try { Plotly.purge(ref.current); } catch {} };
  }, [chart]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
