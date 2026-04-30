import React, { useEffect, useRef } from 'react';

const DARK_LAYOUT = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { color: '#5e7290', family: 'DM Sans, system-ui, sans-serif', size: 11 },
  xaxis: { gridcolor: 'rgba(255,255,255,0.04)', linecolor: 'rgba(255,255,255,0.07)', tickfont: { color: '#3a5070', size: 10 }, zeroline: false },
  yaxis: { gridcolor: 'rgba(255,255,255,0.04)', linecolor: 'rgba(255,255,255,0.07)', tickfont: { color: '#3a5070', size: 10 }, zeroline: false },
  hoverlabel: { bgcolor: '#0f1828', bordercolor: '#182438', font: { color: '#eef2fb', size: 12 } },
  legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: '#5e7290', size: 11 } },
  margin: { t: 8, r: 18, b: 44, l: 52 },
};

export default function PlotlyChart({ chart, height = '360px' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !chart?.figure) return;
    const Plotly = window.Plotly;
    if (!Plotly) return;

    const layout = Object.assign({}, DARK_LAYOUT, chart.figure.layout || {}, {
      autosize: true,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
    });

    // 3D scene styling
    const is3D = (chart.figure.data || []).some(t => ['scatter3d', 'surface', 'mesh3d'].includes(t.type));
    if (is3D) {
      const sa = { backgroundcolor: 'rgba(5,8,16,0.97)', gridcolor: 'rgba(255,255,255,0.05)', color: '#5e7290', showbackground: true };
      layout.scene = Object.assign({}, layout.scene || {}, { bgcolor: 'rgba(5,8,16,0.97)', xaxis: sa, yaxis: sa, zaxis: sa });
      ref.current.style.height = '500px';
    }

    // Animated charts
    const isAnimated = !!(chart.figure.frames?.length);
    if (isAnimated) {
      if (layout.sliders) {
        layout.sliders = layout.sliders.map(s => Object.assign({}, s, {
          font: { color: '#5e7290', size: 10 },
          currentvalue: Object.assign({}, s.currentvalue, { font: { color: '#bdc9e0', size: 12 } }),
          bgcolor: '#0f1828', bordercolor: '#182438', activebgcolor: '#182438',
        }));
      }
      if (layout.updatemenus) {
        layout.updatemenus = layout.updatemenus.map(u => Object.assign({}, u, {
          bgcolor: '#0f1828', bordercolor: '#182438', font: { color: '#bdc9e0', size: 11 },
        }));
      }
      layout.margin = Object.assign({}, layout.margin, { b: 80 });
      ref.current.style.height = '500px';
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
        console.error('Plotly error:', e);
      }
    };
    render();

    return () => {
      try { Plotly.purge(ref.current); } catch {}
    };
  }, [chart]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}
