import React, { useRef } from 'react';
import useStore from '../../store';
import { apiUpload, apiGenerate } from '../../api';
import { toast } from '../../toast';
import { fmtKPI, KPI_COLORS, KPI_ICONS } from '../../utils';
import PlotlyChart from '../PlotlyChart';

export default function Compare() {
  const {
    dash, file,
    compareDash, compareFile, compareMode,
    setCompare, clearCompare,
  } = useStore();

  const fileRef = useRef(null);

  const loadSecond = async (f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['csv','xlsx','xls'].includes(ext)) { toast.error('CSV or Excel only'); return; }
    try {
      toast.info('Uploading second dataset…');
      const data  = await apiUpload(f);
      const dash2 = await apiGenerate(data.id);
      setCompare(data.id, dash2, data.filename);
      toast.success('Second dataset loaded!');
    } catch (e) { toast.error('Failed: ' + e.message); }
  };

  if (!dash) return null;

  return (
    <div className="canvas">
      <div className="dash-hdr fade-up">
        <div className="dash-title">Dataset Comparison</div>
        <div className="dash-sub">Compare two datasets side by side</div>
      </div>

      {/* Dataset labels */}
      <div className="compare-labels">
        <div className="compare-label primary">
          <span className="compare-dot" style={{background:'#4468B0'}} />
          {file || 'Dataset A'}
        </div>
        <div className="compare-label secondary">
          <span className="compare-dot" style={{background:'#10b981'}} />
          {compareFile || 'Dataset B — not loaded'}
        </div>
      </div>

      {/* Upload second dataset */}
      {!compareMode && (
        <div className="compare-upload-card fade-up">
          <div className="compare-upload-icon">⇄</div>
          <div className="compare-upload-title">Load a second dataset to compare</div>
          <div className="compare-upload-sub">Upload any CSV or Excel file to compare KPIs and charts side by side</div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={e => e.target.files[0] && loadSecond(e.target.files[0])} />
          <button className="btn-generate" style={{maxWidth:260, marginTop:16}} onClick={() => fileRef.current?.click()}>
            Upload Dataset B
          </button>
        </div>
      )}

      {compareMode && compareDash && (
        <>
          {/* KPI side-by-side */}
          <div className="compare-kpi-section">
            <div className="compare-kpi-col">
              <div className="compare-col-hd" style={{borderColor:'#4468B0'}}>Dataset A — {file}</div>
              <div className="kpi-grid">
                {(dash.kpis || []).map((k, i) => {
                  const val = k.formatted_value || fmtKPI(k.value, k.format);
                  return (
                    <div key={i} className="kpi-card" style={{'--kc': KPI_COLORS[i % KPI_COLORS.length]}}>
                      <div className="kpi-hd"><span className="kpi-lbl">{k.label}</span><span className="kpi-icon">{KPI_ICONS[i % KPI_ICONS.length]}</span></div>
                      <div className="kpi-val">{val}</div>
                      <div className="kpi-sub">{k.column ? `${k.metric} of ${k.column}` : 'total records'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="compare-kpi-col">
              <div className="compare-col-hd" style={{borderColor:'#10b981'}}>Dataset B — {compareFile}</div>
              <div className="kpi-grid">
                {(compareDash.kpis || []).map((k, i) => {
                  const val = k.formatted_value || fmtKPI(k.value, k.format);
                  return (
                    <div key={i} className="kpi-card" style={{'--kc': KPI_COLORS[i % KPI_COLORS.length]}}>
                      <div className="kpi-hd"><span className="kpi-lbl">{k.label}</span><span className="kpi-icon">{KPI_ICONS[i % KPI_ICONS.length]}</span></div>
                      <div className="kpi-val">{val}</div>
                      <div className="kpi-sub">{k.column ? `${k.metric} of ${k.column}` : 'total records'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Charts side-by-side */}
          <div className="compare-charts-section">
            <div className="compare-charts-col">
              {(dash.charts || []).slice(0, 3).map((ch, i) => (
                <div key={ch.id} className="chart-card" style={{marginBottom:14}}>
                  <div className="chart-hd"><div className="chart-hd-left">
                    <span className="chart-title">{ch.title}</span>
                    <span className="chart-badge">{ch.type}</span>
                  </div></div>
                  <PlotlyChart chart={ch} height="280px" />
                </div>
              ))}
            </div>
            <div className="compare-charts-col">
              {(compareDash.charts || []).slice(0, 3).map((ch, i) => (
                <div key={ch.id} className="chart-card" style={{marginBottom:14, borderColor:'rgba(16,185,129,0.25)'}}>
                  <div className="chart-hd"><div className="chart-hd-left">
                    <span className="chart-title">{ch.title}</span>
                    <span className="chart-badge" style={{color:'#10b981',background:'rgba(16,185,129,0.1)',borderColor:'rgba(16,185,129,0.3)'}}>{ch.type}</span>
                  </div></div>
                  <PlotlyChart chart={ch} height="280px" />
                </div>
              ))}
            </div>
          </div>

          <div style={{textAlign:'center', marginTop:16}}>
            <button className="btn-sample" style={{maxWidth:200}} onClick={clearCompare}>✕ Clear comparison</button>
          </div>
        </>
      )}
    </div>
  );
}
