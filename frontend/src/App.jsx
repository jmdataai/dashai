import React, { useEffect } from 'react';
import useStore from './store';
import Landing from './components/Landing';
import Dashboard from './components/Dashboard';
import Toaster from './components/Toaster';

export default function App() {
  const { page, theme } = useStore();

  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light');
  }, [theme]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      const s = useStore.getState();
      if (e.key === 'Escape') {
        if (s.fullscreenIdx != null) { s.closeFullscreen(); return; }
        if (s.editIdx != null) { s.closeEdit(); return; }
        if (s.chatOpen) { s.toggleChat(); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        s.toggleChat();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'r' && s.did && s.page === 'dashboard') {
        e.preventDefault();
        // Trigger regeneration via a custom event
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
