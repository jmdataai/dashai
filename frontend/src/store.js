import { create } from 'zustand';

const useStore = create((set, get) => ({
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
  filterLoading: false,   // true while filter apply/clear is in-flight

  // Edit panel
  editIdx: null,

  // Fullscreen
  fullscreenIdx: null,

  // Chat
  chatOpen: false,
  chatHistory: [],

  // Filter (what's selected in the dropdowns)
  filter: { col: null, val: null },

  // Actions
  goToDashboard: () => set({ page: 'dashboard', activeTab: 'overview' }),
  goToLanding:   () => set({ page: 'landing', chatOpen: false, filter: { col: null, val: null }, filterLoading: false }),

  setDid:       (did)     => set({ did }),
  setDash:      (dash)    => set({ dash }),
  setProfile:   (profile) => set({ profile }),
  setFile:      (file)    => set({ file }),
  setGenerating:(v)       => set({ generating: v }),
  setFilterLoading: (v)   => set({ filterLoading: v }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  toggleTheme:   () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  openEdit:       (idx) => set({ editIdx: idx }),
  closeEdit:      ()    => set({ editIdx: null }),
  openFullscreen: (idx) => set({ fullscreenIdx: idx }),
  closeFullscreen:()    => set({ fullscreenIdx: null }),

  toggleChat:     () => set((s) => ({ chatOpen: !s.chatOpen })),
  addChatMessage: (msg) => set((s) => ({ chatHistory: [...s.chatHistory, msg] })),
  clearChatHistory:()   => set({ chatHistory: [] }),

  setFilter:   (col, val) => set({ filter: { col, val } }),
  clearFilter: ()         => set({ filter: { col: null, val: null } }),

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
}));

export default useStore;
