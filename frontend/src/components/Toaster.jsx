import React, { useState, useCallback, useEffect } from 'react';
import { initToast } from '../toast';

let _id = 0;
const ICONS = { success: '✓', error: '✕', info: 'ℹ', warn: '⚠' };

export default function Toaster() {
  const [toasts, setToasts] = useState([]);

  const add = useCallback(({ msg, type = 'info', dur = 3200 }) => {
    const id = ++_id;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, out: true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 280);
    }, dur);
  }, []);

  useEffect(() => { initToast(add); }, [add]);

  return (
    <div className="toast-root">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}${t.out ? ' out' : ''}`}>
          <span className="toast-icon">{ICONS[t.type] || 'ℹ'}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
