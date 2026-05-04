import React, { useEffect } from 'react';
import useStore from './store';
import Landing from './components/Landing';
import Dashboard from './components/Dashboard';
import Toaster from './components/Toaster';
import { toast } from './toast';

export default function App() {
  const { page, theme, dash, goToLanding } = useStore();

  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light');
  }, [theme]);

  // Hydration guard — if we restored a dashboard page from localStorage
  // but the dash data is missing, fall back gracefully
  useEffect(() => {
    if (page === 'dashboard' && !dash) {
      goToLanding();
      toast.info('Session restored — please re-upload your file');
    }
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      const s = useStore.getState();
      if (e.key === 'Escape') {
        if (s.fullscreenIdx != null) { s.closeFullscreen(); return; }
        if (s.editIdx != null)       { s.closeEdit();       return; }
        if (s.chatOpen)              { s.toggleChat();      return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault(); s.toggleChat();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'r' && s.did && s.page === 'dashboard') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('dashai:regenerate'));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <>
      <Toaster />
      {page === 'landing' ? <Landing /> : <Dashboard />}
    </>
  );
}
