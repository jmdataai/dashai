import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store';
import { apiChat, apiChartUpdate } from '../api';
import { toast } from '../toast';

export default function ChatPanel() {
  const { chatOpen, toggleChat, chatHistory, addChatMessage, dash, did, profile, updateChart, addChart } = useStore();
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const messagesRef = useRef(null);
  const inputRef    = useRef(null);

  const cols = profile?.columns || [];
  const numCols = cols.filter(c => c.semantic === 'numeric').slice(0, 2);
  const catCols = cols.filter(c => c.semantic === 'categorical').slice(0, 1);
  const suggestions = [
    numCols[0] ? `What's the average ${numCols[0].name}?` : null,
    (catCols[0] && numCols[0]) ? `Show ${numCols[0].name} by ${catCols[0].name}` : null,
    'What are the key insights from this data?',
  ].filter(Boolean);

  useEffect(() => {
    if (chatOpen) inputRef.current?.focus();
  }, [chatOpen]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [chatHistory, thinking]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || !did || thinking) return;
    setInput('');

    addChatMessage({ role: 'user', content: msg });
    setThinking(true);

    try {
      const data = await apiChat(did, msg, dash?.charts || [], chatHistory);
      addChatMessage({ role: 'assistant', content: data.reply });

      if (data.actions?.length) {
        for (const action of data.actions) {
          await processAction(action);
        }
      }
    } catch (e) {
      addChatMessage({ role: 'assistant', content: 'Sorry, something went wrong. Please try again.' });
    } finally {
      setThinking(false);
    }
  };

  const processAction = async (action) => {
    const charts = dash?.charts || [];
    if (action.type === 'update_chart') {
      const idx = charts.findIndex(c => c.id === action.chart_id);
      if (idx < 0) return;
      try {
        const spec = Object.assign({}, charts[idx].spec || {}, action.spec || {});
        const data = await apiChartUpdate(did, spec);
        updateChart(idx, { type: data.type, figure: data.figure, spec: data.spec, title: spec.title || charts[idx].title });
        toast.success('AI updated a chart!');
      } catch { toast.error('AI chart update failed'); }
    } else if (action.type === 'add_chart') {
      const spec = Object.assign({ id: `ai-${Date.now()}`, span: 1 }, action.spec || {});
      try {
        const data = await apiChartUpdate(did, spec);
        addChart({ id: spec.id, type: data.type, title: spec.title || 'AI Chart', subtitle: null, span: spec.span, figure: data.figure, spec: data.spec });
        toast.success('AI added a new chart!');
      } catch { toast.error('AI chart add failed'); }
    }
  };

  const allMessages = [
    { role: 'assistant', content: 'Hi! Ask me about your data, modify charts, or request new visualizations.' },
    ...chatHistory,
  ];

  return (
    <>
      <button className="chat-bubble" onClick={toggleChat}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M4 4h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H7l-4 3V5a1 1 0 0 1 1-1z" stroke="white" strokeWidth="1.6" strokeLinejoin="round"/>
          <path d="M7 8h8M7 11h5" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>

      <div className={`chat-panel${chatOpen ? ' open' : ''}`}>
        <div className="cp-hd">
          <div className="cp-title"><div className="cp-dot" />Ask AI</div>
          <button className="cp-close" onClick={toggleChat}>✕</button>
        </div>

        <div className="cp-messages" ref={messagesRef}>
          {allMessages.map((m, i) => (
            <div key={i} className={`cp-msg ${m.role}`}>
              <div className="cp-bubble">{m.content}</div>
            </div>
          ))}
          {thinking && (
            <div className="cp-msg assistant">
              <div className="cp-bubble cp-thinking">Thinking…</div>
            </div>
          )}
        </div>

        {chatHistory.length === 0 && (
          <div className="cp-suggestions">
            {suggestions.map(s => (
              <button key={s} className="cp-chip" onClick={() => setInput(s)}>{s}</button>
            ))}
          </div>
        )}

        <div className="cp-foot">
          <textarea
            ref={inputRef}
            className="cp-input"
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about your data…"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="cp-send" onClick={send}>▶</button>
        </div>
      </div>
    </>
  );
}
