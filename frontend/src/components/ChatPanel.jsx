import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store';
import { apiChat, apiChartUpdate } from '../api';
import { toast } from '../toast';

export default function ChatPanel() {
  const {
    chatOpen, toggleChat, chatHistory, addChatMessage,
    dash, did, profile, updateChart, addChart,
    suggestedQuestions,
  } = useStore();

  const [input,    setInput]    = useState('');
  const [thinking, setThinking] = useState(false);
  const messagesRef = useRef(null);
  const inputRef    = useRef(null);

  const cols    = profile?.columns || [];
  const numCols = cols.filter(c => c.semantic === 'numeric');
  const catCols = cols.filter(c => c.semantic === 'categorical');

  // Contextual chips — blend suggested questions from backend + dynamic ones
  const chips = [
    ...(suggestedQuestions || []).slice(0, 3),
    numCols[0] && catCols[0]
      ? `Show ${numCols[0].name} by ${catCols[0].name} as bar chart`
      : null,
    'What are the key trends in this data?',
    'Add a correlation scatter chart',
  ].filter(Boolean).slice(0, 5);

  useEffect(() => { if (chatOpen) inputRef.current?.focus(); }, [chatOpen]);
  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [chatHistory, thinking]);

  const chatError = (msg) => {
    addChatMessage({ role: 'assistant', content: `⚠ ${msg}`, isError: true });
    toast.error(msg, 4000);
  };

  const send = async (msg) => {
    const text = (msg || input).trim();
    if (!text || !did || thinking) return;
    setInput('');
    addChatMessage({ role: 'user', content: text });
    setThinking(true);
    try {
      const data = await apiChat(did, text, dash?.charts || [], chatHistory);
      addChatMessage({ role: 'assistant', content: data.reply });
      if (data.actions?.length) {
        for (const action of data.actions) await processAction(action);
      }
    } catch (e) {
      chatError('Connection failed. Please try again.');
    } finally {
      setThinking(false);
    }
  };

  const processAction = async (action) => {
    const charts = dash?.charts || [];
    if (action.type === 'update_chart') {
      const idx = charts.findIndex(c => c.id === action.chart_id);
      if (idx < 0) {
        chatError(`Chart "${action.chart_id}" not found. IDs: ${charts.map(c => c.id).join(', ')}`);
        return;
      }
      try {
        const spec = Object.assign({}, charts[idx].spec || {}, action.spec || {});
        const data = await apiChartUpdate(did, spec);
        updateChart(idx, { type: data.type, figure: data.figure, spec: data.spec, title: spec.title || charts[idx].title });
        toast.success(`Updated "${charts[idx].title}"`);
      } catch (e) {
        chatError(`Could not update chart: ${e.message}`);
      }
    } else if (action.type === 'add_chart') {
      const spec = Object.assign({ id: `ai-${Date.now()}`, span: 1 }, action.spec || {});
      try {
        const data = await apiChartUpdate(did, spec);
        addChart({ id: spec.id, type: data.type, title: spec.title || 'AI Chart',
                   subtitle: null, span: spec.span, figure: data.figure, spec: data.spec });
        toast.success('New chart added!');
      } catch (e) {
        chatError(`Could not add chart: ${e.message}`);
      }
    }
  };

  const allMessages = [
    { role: 'assistant', content: 'Hi! Ask me about your data, or try one of the suggestions below.' },
    ...chatHistory,
  ];

  return (
    <>
      <button className="chat-bubble" onClick={toggleChat} title="Ask AI (Ctrl+/)">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M4 4h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H7l-4 3V5a1 1 0 0 1 1-1z"
            stroke="white" strokeWidth="1.6" strokeLinejoin="round"/>
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
              <div className={`cp-bubble${m.isError ? ' cp-error' : ''}`}>{m.content}</div>
            </div>
          ))}
          {thinking && (
            <div className="cp-msg assistant">
              <div className="cp-bubble cp-thinking">
                <span className="spin" style={{width:10,height:10,display:'inline-block',marginRight:6}} />
                Thinking…
              </div>
            </div>
          )}
        </div>

        {/* Contextual suggestions — always visible, not just empty */}
        {chips.length > 0 && chatHistory.length < 3 && (
          <div className="cp-suggestions">
            <div className="cp-suggestions-label">Try asking:</div>
            {chips.map(s => (
              <button key={s} className="cp-chip" onClick={() => send(s)}>{s}</button>
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
            placeholder="e.g. Show revenue by region as a bar chart…"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="cp-send" onClick={() => send()} disabled={thinking}>▶</button>
        </div>
      </div>
    </>
  );
}
