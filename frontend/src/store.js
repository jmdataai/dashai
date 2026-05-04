import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useStore = create(
  persist(
    (set, get) => ({
      // Navigation
      page: 'landing',

      // Data
      did: null,
      dash: null,
      profile: null,
      file: '',

      // UI
      activeTab: 'overview',
      theme: 'dark',
      sidebarCollapsed: false,
      generating: false,
      filterLoading: false,

      // Edit / Fullscreen (transient — not persisted)
      editIdx: null,
      fullscreenIdx: null,

      // Chat
      chatOpen: false,
      chatHistory: [],

      // Filter
      filter: { col: null, val: null },

      // Compare mode (second dataset)
      compareDid: null,
      compareDash: null,
      compareFile: '',
      compareMode: false,

      // Actions
      goToDashboard: () => set({ page: 'dashboard', activeTab: 'overview' }),
      goToLanding:   () => set({
        page: 'landing', chatOpen: false,
        filter: { col: null, val: null }, filterLoading: false,
        compareMode: false, compareDid: null, compareDash: null, compareFile: '',
      }),

      setDid:       (did)     => set({ did }),
      setDash:      (dash)    => set({ dash }),
      setProfile:   (profile) => set({ profile }),
      setSuggestedQuestions: (q) => set({ suggestedQuestions: q }),
      setFile:      (file)    => set({ file }),
      setGenerating:(v)       => set({ generating: v }),
      setFilterLoading: (v)   => set({ filterLoading: v }),

      setActiveTab: (tab) => set({ activeTab: tab }),

      toggleTheme:   () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      openEdit:        (idx) => set({ editIdx: idx }),
      closeEdit:       ()    => set({ editIdx: null }),
      openFullscreen:  (idx) => set({ fullscreenIdx: idx }),
      closeFullscreen: ()    => set({ fullscreenIdx: null }),

      toggleChat:      () => set((s) => ({ chatOpen: !s.chatOpen })),
      addChatMessage:  (msg) => set((s) => ({ chatHistory: [...s.chatHistory, msg] })),
      clearChatHistory:()   => set({ chatHistory: [] }),

      setFilter:   (col, val) => set({ filter: { col, val } }),
      clearFilter: ()         => set({ filter: { col: null, val: null } }),

      suggestedQuestions: [],

      // Compare dataset
      setCompare: (did, dash, file) => set({ compareDid: did, compareDash: dash, compareFile: file, compareMode: true }),
      clearCompare: () => set({ compareDid: null, compareDash: null, compareFile: '', compareMode: false }),

      updateChart: (idx, updates) => set((s) => {
        if (!s.dash?.charts) return {};
        const charts = [...s.dash.charts];
        charts[idx] = { ...charts[idx], ...updates };
        return { dash: { ...s.dash, charts } };
      }),

      addChart: (chart) => set((s) => {
        if (!s.dash) return {};
        return { dash: { ...s.dash, charts: [...(s.dash.charts || []), chart] } };
      }),

      deleteChart: (idx) => set((s) => {
        if (!s.dash?.charts) return {};
        const charts = s.dash.charts.filter((_, i) => i !== idx);
        return { dash: { ...s.dash, charts } };
      }),

      duplicateChart: (idx) => set((s) => {
        if (!s.dash?.charts?.[idx]) return {};
        const orig = s.dash.charts[idx];
        const copy = { ...orig, id: orig.id + '_copy', title: (orig.title || 'Chart') + ' (copy)' };
        return { dash: { ...s.dash, charts: [...s.dash.charts, copy] } };
      }),
    }),
    {
      name: 'jmdata-talent-dash',   // localStorage key
      // Only persist these — skip transient UI state
      partialize: (s) => ({
        page:            s.page,
        did:             s.did,
        // dash & compareDash intentionally excluded — Plotly figure JSONs are too large for localStorage
        // On refresh, App.jsx detects missing dash and redirects to landing gracefully
        profile:         s.profile,
        file:            s.file,
        activeTab:       s.activeTab,
        theme:           s.theme,
        sidebarCollapsed:s.sidebarCollapsed,
        filter:          s.filter,
        // Cap chat history at last 20 messages to prevent localStorage growth
        chatHistory:     s.chatHistory.slice(-20),
        compareDid:      s.compareDid,
        compareFile:     s.compareFile,
        compareMode:     s.compareMode,
        suggestedQuestions: s.suggestedQuestions,
      }),
    }
  )
);

export default useStore;
