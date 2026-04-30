import React, { useRef, useEffect } from 'react';
import useStore from '../store';
import { apiGenerate } from '../api';
import { toast } from '../toast';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import EditPanel from './EditPanel';
import FullscreenModal from './FullscreenModal';
import ChatPanel from './ChatPanel';
import Overview  from './tabs/Overview';
import Charts    from './tabs/Charts';
import Insights  from './tabs/Insights';
import Stats     from './tabs/Stats';
import Data      from './tabs/Data';

const TABS = {
  overview: Overview,
  charts:   Charts,
  insights: Insights,
  stats:    Stats,
  data:     Data,
};

export default function Dashboard() {
  const { activeTab, did, setDash, setGenerating, dash } = useStore();
  const genTimer = useRef(null);
  const genBar   = useRef(null);
  const genText  = useRef(null);
  const [generating, setLocalGen] = React.useState(false);

  const doRegenerate = async () => {
    if (!did) return;
    setLocalGen(true); setGenerating(true);
    startAnim();
    try {
      const d = await apiGenerate(did);
      setDash(d);
      toast.success('Dashboard regenerated!');
    } catch (e) {
      toast.error('Regeneration failed: ' + e.message);
    } finally {
      stopAnim();
      setLocalGen(false); setGenerating(false);
    }
  };

  const startAnim = () => {
    const steps = ['Analyzing dataset…','AI selecting charts…','Building visualizations…','Assembling dashboard…'];
    let si = 0, pct = 3;
    if (genText.current) genText.current.textContent = steps[0];
    if (genBar.current)  genBar.current.style.width  = '3%';
    genTimer.current = setInterval(() => {
      si = (si + 1) % steps.length;
      pct = Math.min(92, pct + 18 + Math.random() * 8);
      if (genText.current) genText.current.textContent = steps[si];
      if (genBar.current)  genBar.current.style.width = pct + '%';
    }, 1500);
  };
  const stopAnim = () => {
    clearInterval(genTimer.current);
    if (genBar.current) genBar.current.style.width = '100%';
    setTimeout(() => setLocalGen(false), 300);
  };

  // Listen for Ctrl+R event from App.jsx
  useEffect(() => {
    const handler = () => doRegenerate();
    window.addEventListener('dashai:regenerate', handler);
    return () => window.removeEventListener('dashai:regenerate', handler);
  }, [did]);

  const TabComponent = TABS[activeTab] || Overview;

  return (
    <div className="dash-root">
      {/* Generating overlay */}
      {generating && (
        <div className="gen-overlay">
          <div className="gen-orbit"><div className="gen-ring" /><div className="gen-ring r2" /></div>
          <div className="gen-title" ref={genText}>Analyzing dataset…</div>
          <div className="gen-sub">Regenerating your dashboard</div>
          <div className="gen-bar"><div className="gen-fill" ref={genBar} /></div>
        </div>
      )}

      <Sidebar onRegenerate={doRegenerate} />

      <div className="main-content">
        <Topbar />
        <div className="tab-panels">
          {Object.entries(TABS).map(([id, TabComp]) => (
            <div key={id} className={`tab-panel${activeTab === id ? ' active' : ''}`}>
              <TabComp />
            </div>
          ))}
        </div>
      </div>

      <EditPanel />
      <FullscreenModal />
      <ChatPanel />
    </div>
  );
}
