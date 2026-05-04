import React, { useState } from 'react';
import useStore from '../../store';
import { apiReport } from '../../api';
import { toast } from '../../toast';

export default function Insights() {
  const { dash, profile, did } = useStore();
  const [report,      setReport]      = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  if (!dash || !profile) return null;

  const cols      = profile.columns || [];
  const nullCols  = cols.filter(c => c.n_null > 0);
  const numCols   = cols.filter(c => c.semantic === 'numeric');
  const catCols   = cols.filter(c => c.semantic === 'categorical');
  const dtCols    = cols.filter(c => c.semantic === 'datetime');
  const outliers  = profile.outlier_cols || [];
  const health    = profile.data_health || {};
  const typeCounts = {};
  (dash.charts || []).forEach(ch => { typeCounts[ch.type] = (typeCounts[ch.type] || 0) + 1; });

  const generateReport = async () => {
    if (!did) return;
    setReportLoading(true);
    try {
      const result = await apiReport(did);
      setReport(result.paragraphs || [result.report]);
      toast.success('Executive report generated!');
    } catch (e) {
      toast.error('Report failed: ' + e.message);
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className="canvas">
      <div className="dash-hdr fade-up">
        <div className="dash-title">AI Insights</div>
        <div className="dash-sub">Automated analysis of your dataset</div>
      </div>

      {/* ── Key findings ── */}
      {dash.insights?.length > 0 && (
        <div className="ins-card fade-up">
          <div className="ins-card-hd"><span>✦</span> Key Findings</div>
          <ul className="ins-list">
            {dash.insights.map((ins, i) => <li key={i} className="ins-item">{ins}</li>)}
          </ul>
        </div>
      )}

      {/* ── Executive Report ── */}
      <div className="ins-card fade-up d1">
        <div className="ins-card-hd">
          <span>▤</span> Executive Report
          {!report && (
            <button
              className="ins-report-btn"
              onClick={generateReport}
              disabled={reportLoading}
            >
              {reportLoading
                ? <><span className="spin" style={{width:10,height:10,display:'inline-block',marginRight:6}} />Generating…</>
                : '✦ Generate Report'}
            </button>
          )}
        </div>
        {report ? (
          <div className="ins-report">
            {report.map((para, i) => (
              <p key={i} className="ins-report-para">{para}</p>
            ))}
            <button className="ins-report-copy" onClick={() => {
              navigator.clipboard.writeText(report.join('\n\n'));
              toast.success('Copied to clipboard!');
            }}>⧉ Copy report</button>
          </div>
        ) : (
          <div className="ins-report-placeholder">
            Click "Generate Report" to get a 3-paragraph AI-written executive summary of your data.
            Uses 1 LLM call.
          </div>
        )}
      </div>

      {/* ── Data profile stats ── */}
      <div className="ins-card fade-up d2">
        <div className="ins-card-hd"><span>◎</span> Data Profile</div>
        <div className="ins-stat-grid">
          <div className="ins-stat">
            <div className="ins-stat-val">{profile.rows.toLocaleString()}</div>
            <div className="ins-stat-lbl">Total Rows</div>
          </div>
          <div className="ins-stat">
            <div className="ins-stat-val">{numCols.length}</div>
            <div className="ins-stat-lbl">Numeric Cols</div>
          </div>
          <div className="ins-stat">
            <div className="ins-stat-val">{catCols.length}</div>
            <div className="ins-stat-lbl">Category Cols</div>
          </div>
          <div className="ins-stat">
            <div className="ins-stat-val">{dtCols.length}</div>
            <div className="ins-stat-lbl">Date Cols</div>
          </div>
          <div className={`ins-stat ${nullCols.length ? 'warn' : 'ok'}`}>
            <div className="ins-stat-val">{nullCols.length}</div>
            <div className="ins-stat-lbl">Cols with Nulls</div>
          </div>
          <div className={`ins-stat ${health.duplicate_rows > 0 ? 'warn' : 'ok'}`}>
            <div className="ins-stat-val">{health.duplicate_rows || 0}</div>
            <div className="ins-stat-lbl">Duplicate Rows</div>
          </div>
        </div>
        {nullCols.length > 0 && (
          <div className="ins-null-warn">⚠ Missing values in: {nullCols.map(c => c.name).join(', ')}</div>
        )}
      </div>

      {/* ── Outlier callouts ── */}
      {outliers.length > 0 && (
        <div className="ins-card fade-up d3">
          <div className="ins-card-hd"><span>⚡</span> Outlier Detection</div>
          <div className="ins-outlier-grid">
            {outliers.map(o => (
              <div key={o.col} className="ins-outlier-item">
                <div className="ins-outlier-col">{o.col}</div>
                <div className="ins-outlier-count">{o.count} outliers</div>
                <div className="ins-outlier-pct">{o.pct}% of values</div>
                <div className="ins-outlier-bar">
                  <div className="ins-outlier-fill" style={{width: `${Math.min(o.pct * 4, 100)}%`}} />
                </div>
              </div>
            ))}
          </div>
          <div className="ins-null-warn" style={{marginTop: 10}}>
            ℹ Outliers defined as values more than 3 standard deviations from the mean (z-score &gt; 3).
          </div>
        </div>
      )}

      {/* ── Chart types ── */}
      {Object.keys(typeCounts).length > 0 && (
        <div className="ins-card fade-up d4">
          <div className="ins-card-hd"><span>▣</span> Charts Generated</div>
          <div className="ins-chips">
            {Object.entries(typeCounts).map(([t, n]) => (
              <span key={t} className="ins-chip">{t} <span className="ins-chip-count">×{n}</span></span>
            ))}
          </div>
        </div>
      )}

      {/* ── Suggested questions ── */}
      {profile.suggested_questions?.length > 0 && (
        <div className="ins-card fade-up d4">
          <div className="ins-card-hd"><span>?</span> Suggested Questions</div>
          <div className="ins-q-list">
            {profile.suggested_questions.map((q, i) => (
              <div key={i} className="ins-q-item">{q}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
