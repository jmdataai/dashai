import React, { useState, useRef, useEffect, useCallback } from 'react';
import useStore from '../store';
import { apiUpload, apiSample, apiGenerate, apiHealth } from '../api';
import { toast } from '../toast';

/* ── JM Brand Mark SVG (blue version) ── */
function JMLogo({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* J stroke */}
      <path d="M7 6 L7 28 Q7 36 0 37" stroke="#0C162A" strokeWidth="0" fill="none"/>
      <path fillRule="evenodd" clipRule="evenodd"
        d="M5 5 L12 5 L12 27 Q12 36 3 37 L1 37 Q-1 37 -1 35 L-1 33 Q5 33 5 26 Z"
        fill="#0C162A" transform="translate(4,1) scale(0.85)"/>
      {/* M stroke */}
      <path fillRule="evenodd" clipRule="evenodd"
        d="M14 5 L19 5 L24 20 L29 5 L34 5 L34 35 L28 35 L28 22 L24 35 L20 35 L16 22 L16 35 L10 35 L10 5 Z"
        fill="#0C162A" transform="translate(6,2) scale(0.78)"/>
    </svg>
  );
}

export default function Landing() {
  const { toggleTheme, theme, setDid, setDash, setProfile, setFile, goToDashboard, setGenerating } = useStore();
  const [status, setStatus]     = useState({ dot: '', text: 'Connecting…' });
  const [fileData, setFileData] = useState(null);
  const [chips, setChips]       = useState([]);
  const [stMsg, setStMsg]       = useState('');
  const [err, setErr]           = useState('');
  const [over, setOver]         = useState(false);
  const [generating, setLocalGen] = useState(false);
  const fileRef  = useRef(null);
  const genTimer = useRef(null);
  const genBar   = useRef(null);
  const genText  = useRef(null);

  useEffect(() => {
    apiHealth().then(d => {
      const ok = Object.values(d.providers || {}).some(v => v);
      setStatus({ dot: ok ? 'online' : 'warn', text: ok ? 'AI Engine Online' : 'No API Keys' });
    }).catch(() => setStatus({ dot: '', text: 'Offline' }));
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv','xlsx','xls'].includes(ext)) { setErr('Upload CSV or Excel files only.'); return; }
    setErr(''); setFileData(null); setChips([]);
    setStMsg('Uploading & analyzing columns…');
    try {
      const data = await apiUpload(file);
      setFileData(data); setChips(data.columns || []);
      setStMsg('');
      setDid(data.id); setProfile(data); setFile(data.filename);
      await doGenerate(data.id, data);
    } catch (e) { setStMsg(''); setErr(e.message); }
  }, []);

  const doGenerate = async (did) => {
    setLocalGen(true); setGenerating(true);
    startOverlayAnim();
    try {
      const dash = await apiGenerate(did);
      setDash(dash);
      goToDashboard();
    } catch (e) {
      toast.error('Generation failed: ' + e.message);
    } finally {
      stopOverlayAnim();
      setLocalGen(false); setGenerating(false);
    }
  };

  const startOverlayAnim = () => {
    const steps = ['Analyzing dataset…','Profiling columns…','AI selecting charts…','Building visualizations…','Assembling dashboard…'];
    let si = 0, pct = 3;
    if (genText.current) genText.current.textContent = steps[0];
    if (genBar.current)  genBar.current.style.width = '3%';
    genTimer.current = setInterval(() => {
      si = (si + 1) % steps.length;
      pct = Math.min(92, pct + 14 + Math.random() * 8);
      if (genText.current) genText.current.textContent = steps[si];
      if (genBar.current)  genBar.current.style.width = pct + '%';
    }, 1500);
  };
  const stopOverlayAnim = () => {
    clearInterval(genTimer.current);
    if (genBar.current) genBar.current.style.width = '100%';
  };

  const loadSample = async () => {
    setErr(''); setStMsg('Loading sample data…');
    try {
      const data = await apiSample('sales');
      setFileData(data); setChips(data.columns || []);
      setDid(data.id); setProfile(data); setFile(data.filename);
      setStMsg('');
      await doGenerate(data.id, data);
    } catch (e) { setStMsg(''); setErr(e.message); }
  };

  const onDrop = (e) => { e.preventDefault(); setOver(false); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); };

  return (
    <div className="landing-root">
      {/* Animated mesh */}
      <div className="landing-mesh">
        <div className="mesh-blob b1" /><div className="mesh-blob b2" /><div className="mesh-blob b3" />
      </div>

      {/* Generating overlay */}
      {generating && (
        <div className="gen-overlay">
          <div className="gen-orbit"><div className="gen-ring" /><div className="gen-ring r2" /></div>
          <div className="gen-title" ref={genText}>Analyzing dataset…</div>
          <div className="gen-sub">Building your enterprise dashboard</div>
          <div className="gen-bar"><div className="gen-fill" ref={genBar} /></div>
        </div>
      )}

      {/* Nav */}
      <nav className="land-nav">
        <div className="brand">
          {/* Logo — drop logo-blue.png into /public/assets/ to replace */}
          <div className="brand-mark">
            <img
              src="/assets/logo-blue.png"
              alt="JMData"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
            />
            <JMLogo size={20} style={{ display: 'none' }} />
          </div>
          <div>
            <span className="brand-name">JMData Talent</span>
          </div>
        </div>
        <div className="nav-right">
          <button className="theme-btn" onClick={toggleTheme}>
            <span>{theme === 'dark' ? '🌙' : '☀️'}</span>
            <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
          </button>
          <div className="status-pill">
            <span className={`status-dot ${status.dot}`} />
            <span>{status.text}</span>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="land-hero">
        <div className="hero-eyebrow">Enterprise Analytics Platform</div>
        <h1 className="hero-title">
          Your Data.<br />
          <span className="hero-em">Instant Intelligence.</span>
        </h1>
        <p className="hero-sub">
          Upload any CSV or Excel file. Our AI engine profiles every column, selects optimal
          visualizations, and assembles a boardroom-ready analytics dashboard — automatically.
        </p>

        {/* Upload panel */}
        <div className="upload-panel">
          <div className="upload-inner">
            {fileData && (
              <div className="file-preview show">
                <svg width="18" height="22" viewBox="0 0 18 22" fill="none"><path d="M11 1H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6l-5-5z" stroke="currentColor" strokeWidth="1.4"/><path d="M11 1v5h5" stroke="currentColor" strokeWidth="1.4"/></svg>
                <div>
                  <div className="fp-name">{fileData.filename}</div>
                  <div className="fp-tags">
                    <span className="fp-tag">{fileData.rows?.toLocaleString()} rows</span>
                    <span className="fp-tag">{fileData.usable_cols} columns</span>
                  </div>
                </div>
              </div>
            )}

            {chips.length > 0 && (
              <div className="col-chips show">
                {chips.slice(0, 18).map(c => {
                  const tp  = c.semantic === 'numeric' ? 'n' : c.semantic === 'datetime' ? 'd' : 'c';
                  const lbl = tp === 'n' ? '#' : tp === 'd' ? 'DT' : 'T';
                  return (
                    <div key={c.name} className="chip">
                      <span className={`ct ct-${tp}`}>{lbl}</span>{c.name}
                    </div>
                  );
                })}
              </div>
            )}

            {stMsg && <div className="st-row show"><div className="spin" /><span>{stMsg}</span></div>}
            {err   && <div className="err-msg show">⚠ {err}</div>}

            <label
              className={`drop-zone${over ? ' over' : ''}`}
              onDragOver={e => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none"><circle cx="22" cy="22" r="21" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" opacity=".25"/><path d="M22 30V14M16 20l6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <div className="drop-label">Drop CSV or Excel file</div>
              <div className="drop-hint">.csv · .xlsx · .xls · up to 25 MB</div>
            </label>

            <div className="sep"><span>or</span></div>

            <button className="btn-generate" disabled={generating} onClick={() => fileRef.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1v4M8 11v4M1 8h4M11 8h4M3.8 3.8l2.8 2.8M9.4 9.4l2.8 2.8M3.8 12.2l2.8-2.8M9.4 6.6l2.8-2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              {generating ? 'Generating…' : 'Upload & Generate Dashboard'}
            </button>
            <button className="btn-sample" onClick={loadSample} disabled={generating}>
              Try with 192 rows of sample sales data →
            </button>
          </div>
        </div>

        {/* Feature cards */}
        <div className="features-row">
          {[
            { icon: '✦', title: 'AI Chart Selection',  desc: 'LLM cascade picks the best chart types for your specific data' },
            { icon: '▣', title: '12+ Chart Types',      desc: 'Bar, line, scatter, 3D, animated, heatmap, treemap and more' },
            { icon: '↓', title: 'Export & Share',       desc: 'Download interactive HTML dashboards or high-res PNG exports' },
          ].map(f => (
            <div key={f.title} className="feat-card">
              <div className="feat-icon">{f.icon}</div>
              <div className="feat-title">{f.title}</div>
              <div className="feat-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
