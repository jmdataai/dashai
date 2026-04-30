import React from 'react';
import useStore from '../store';
import PlotlyChart from './PlotlyChart';

export default function FullscreenModal() {
  const { fullscreenIdx, closeFullscreen, dash } = useStore();
  if (fullscreenIdx == null) return null;
  const chart = dash?.charts?.[fullscreenIdx];
  if (!chart) return null;

  return (
    <div className="fs-modal">
      <div className="fs-top">
        <span className="fs-title-txt">{chart.title}</span>
        <button className="fs-close" onClick={closeFullscreen}>✕ Close</button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <PlotlyChart chart={chart} height="calc(100vh - 110px)" />
      </div>
    </div>
  );
}
