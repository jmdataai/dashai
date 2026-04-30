import React from 'react';
import useStore from '../../store';
import ChartCard from '../ChartCard';

export default function Charts() {
  const { dash } = useStore();
  if (!dash) return null;
  const charts = dash.charts || [];

  return (
    <div className="canvas">
      <div className="dash-hdr">
        <div className="dash-title">All Charts</div>
        <div className="dash-sub">{charts.length} visualizations — click ⋮ to edit, fullscreen, or remove</div>
      </div>
      <div className="charts-stack">
        {charts.map((ch, i) => (
          <ChartCard key={ch.id + i} chart={ch} idx={100 + i} height="440px" />
        ))}
      </div>
    </div>
  );
}
