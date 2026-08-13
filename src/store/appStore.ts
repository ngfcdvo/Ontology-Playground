import { create } from 'zustand';
import type { Quest } from '../data/quests';
import { quests as defaultQuests } from '../data/quests';
import type { Ontology, DataBinding, EntityInstance, RelationshipInstance } from '../data/ontology';
import { businessOntology, businessBindings, businessInstances, businessRelationshipInstances } from '../data/businessOntology';
import { generateQuestsForOntology } from '../data/questGenerator';
import { loadInstancesFromDoris, checkDorisHealth } from '../lib/dorisClient';
import { syncToNebula as syncToNebulaApi, getNebulaConfig } from '../lib/nebulaClient';
import type { SyncResult } from '../lib/nebulaClient';

export type ThemeId = 'dark' | 'light' | 'aurora' | 'crimson';

export const THEME_OPTIONS: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'dark', label: 'Dark', swatch: '#1B1B1B' },
  { id: 'light', label: 'Light', swatch: '#F5F5F5' },
  { id: 'aurora', label: 'Aurora', swatch: '#2AAA92' },
  { id: 'crimson', label: 'Crimson', swatch: '#D6002A' },
];

const DARK_BASED_THEMES: ThemeId[] = ['dark', 'aurora'];

/** Whether a theme uses the dark base palette (drives graph/RDF rendering). */
export function isDarkTheme(theme: ThemeId): boolean {
  return DARK_BASED_THEMES.includes(theme);
}

/** CSS class(es) applied to a themed root element. */
export function themeClass(theme: ThemeId): string {
  switch (theme) {
    case 'light':
      return 'light-theme';
    case 'aurora':
      return 'theme-aurora';
    case 'crimson':
      return 'light-theme theme-crimson';
    default:
      return '';
  }
}

function getInitialTheme(): ThemeId {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return 'dark';
  }
  try {
    const stored = window.localStorage.getItem('theme');
    if (stored && THEME_OPTIONS.some((t) => t.id === stored)) {
      return stored as ThemeId;
    }
    // Migrate the legacy light/dark flag
    if (window.localStorage.getItem('darkMode') === 'false') {
      return 'light';
    }
    return 'dark';
  } catch {
    return 'dark';
  }
}

const initialTheme = getInitialTheme();

interface AppState {
  // Ontology State
  currentOntology: Ontology;
  dataBindings: DataBinding[];
  entityInstances: EntityInstance[];
  relationshipInstances: RelationshipInstance[];
  
  // UI State
  selectedEntityId: string | null;
  selectedRelationshipId: string | null;
  highlightedEntities: string[];
  highlightedRelationships: string[];
  showDataBindings: boolean;
  graphViewMode: 'schema' | 'instance';
  selectedInstanceKey: string | null; // "entityTypeId:identifierValue" in instance view
  theme: ThemeId;
  darkMode: boolean;
  
  // Quest State
  availableQuests: Quest[];
  activeQuest: Quest | null;
  currentStepIndex: number;
  completedQuests: string[];
  earnedBadges: { badge: string; icon: string }[];
  totalPoints: number;
  
  // Query State
  queryInput: string;
  queryResult: string | null;
  
  // Doris Connection State
  dorisStatus: 'idle' | 'connecting' | 'connected' | 'error';
  dorisMessage: string | null;
  
  // NebulaGraph Sync State
  nebulaStatus: 'idle' | 'syncing' | 'synced' | 'error';
  nebulaMessage: string | null;
  nebulaResult: SyncResult | null;
  
  // Ontology Actions
  loadOntology: (ontology: Ontology, bindings?: DataBinding[]) => void;
  resetToDefault: () => void;
  exportOntology: () => string;
  loadFromDoris: () => Promise<void>;
  checkDoris: () => Promise<void>;
  syncToNebula: () => Promise<void>;
  checkNebula: () => Promise<void>;
  
  // Actions
  selectEntity: (id: string | null) => void;
  selectRelationship: (id: string | null) => void;
  setHighlightedEntities: (ids: string[]) => void;
  setHighlightedRelationships: (ids: string[]) => void;
  setHighlights: (entityIds: string[], relIds: string[]) => void;
  setGraphViewMode: (mode: 'schema' | 'instance') => void;
  selectInstance: (key: string | null) => void;
  toggleDataBindings: () => void;
  setTheme: (theme: ThemeId) => void;
  toggleDarkMode: () => void;
  
  // Quest Actions
  startQuest: (questId: string) => void;
  advanceQuestStep: () => void;
  completeQuest: () => void;
  abandonQuest: () => void;
  
  // Query Actions
  setQueryInput: (input: string) => void;
  setQueryResult: (result: string | null) => void;
  clearHighlights: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial Ontology State — 默认使用业务本体(基于 Doris 数仓)
  currentOntology: businessOntology,
  dataBindings: businessBindings,
  entityInstances: businessInstances,
  relationshipInstances: businessRelationshipInstances,
  
  // Initial UI State
  selectedEntityId: null,
  selectedRelationshipId: null,
  highlightedEntities: [],
  highlightedRelationships: [],
  showDataBindings: false,
  graphViewMode: 'schema',
  selectedInstanceKey: null,
  theme: initialTheme,
  darkMode: isDarkTheme(initialTheme),
  
  // Initial Quest State - use default quests for Fourth Coffee
  availableQuests: defaultQuests,
  activeQuest: null,
  currentStepIndex: 0,
  completedQuests: [],
  earnedBadges: [],
  totalPoints: 0,
  
  // Initial Query State
  queryInput: '',
  queryResult: null,

  // Initial Doris State
  dorisStatus: 'idle',
  dorisMessage: null,

  // Initial NebulaGraph State
  nebulaStatus: 'idle',
  nebulaMessage: null,
  nebulaResult: null,

  // Ontology Actions
  loadOntology: (ontology, bindings = []) => {
    // Generate new quests based on the loaded ontology
    const newQuests = generateQuestsForOntology(ontology);
    set({
      currentOntology: ontology,
      dataBindings: bindings,
      // Reset instance data — loaded ontologies (e.g. from catalogue) don't
      // carry sample instances. Only the default Fourth Coffee ontology has them.
      entityInstances: [],
      relationshipInstances: [],
      selectedEntityId: null,
      selectedRelationshipId: null,
      highlightedEntities: [],
      highlightedRelationships: [],
      graphViewMode: 'schema',
      selectedInstanceKey: null,
      activeQuest: null,
      currentStepIndex: 0,
      availableQuests: newQuests,
      // Reset completed quests when loading a new ontology
      completedQuests: []
    });
  },
  
  resetToDefault: () => set({
    currentOntology: businessOntology,
    dataBindings: businessBindings,
    entityInstances: businessInstances,
    relationshipInstances: businessRelationshipInstances,
    selectedEntityId: null,
    selectedRelationshipId: null,
    highlightedEntities: [],
    highlightedRelationships: [],
    graphViewMode: 'schema',
    selectedInstanceKey: null,
    availableQuests: defaultQuests,
    activeQuest: null,
    currentStepIndex: 0,
    completedQuests: []
  }),
  
  exportOntology: () => {
    const { currentOntology, dataBindings } = get();
    return JSON.stringify({ ontology: currentOntology, bindings: dataBindings }, null, 2);
  },

  // ── Doris 数据加载 ──
  checkDoris: async () => {
    set({ dorisStatus: 'connecting', dorisMessage: null });
    try {
      const result = await checkDorisHealth();
      if (result.status === 'ok') {
        set({ dorisStatus: 'connected', dorisMessage: `已连接: ${result.doris?.host}:${result.doris?.port}` });
      } else {
        set({ dorisStatus: 'error', dorisMessage: result.message || '连接失败' });
      }
    } catch (err) {
      set({ dorisStatus: 'error', dorisMessage: (err as Error).message });
    }
  },

  loadFromDoris: async () => {
    const { currentOntology, dataBindings } = get();
    set({ dorisStatus: 'connecting', dorisMessage: '正在从 Doris 加载数据...' });
    try {
      const result = await loadInstancesFromDoris({
        entityTypes: currentOntology.entityTypes,
        relationships: currentOntology.relationships,
        bindings: dataBindings,
        limitPerEntity: 200,
      });
      set({
        entityInstances: result.entityInstances,
        relationshipInstances: result.relationshipInstances,
        dorisStatus: 'connected',
        dorisMessage: `已加载 ${result.entityInstances.length} 条实例，${result.relationshipInstances.length} 条关系` +
          (result.errors.length > 0 ? `（${result.errors.length} 个实体加载失败）` : ''),
      });
    } catch (err) {
      set({ dorisStatus: 'error', dorisMessage: (err as Error).message });
    }
  },

  // ── NebulaGraph 同步 ──
  checkNebula: async () => {
    set({ nebulaStatus: 'syncing', nebulaMessage: '检查 NebulaGraph...' });
    try {
      const config = await getNebulaConfig();
      if (config.consoleAvailable) {
        set({ nebulaStatus: 'synced', nebulaMessage: `NebulaGraph 可用: ${config.host}:${config.port} / ${config.space}` });
      } else {
        set({ nebulaStatus: 'idle', nebulaMessage: `nebula-console 不可用（${config.host}:${config.port}），将生成 nGQL 脚本` });
      }
    } catch (err) {
      set({ nebulaStatus: 'error', nebulaMessage: (err as Error).message });
    }
  },

  syncToNebula: async () => {
    const { currentOntology, entityInstances, relationshipInstances } = get();
    if (entityInstances.length === 0) {
      set({ nebulaStatus: 'error', nebulaMessage: '无实例数据，请先连接 Doris 加载数据' });
      return;
    }
    set({ nebulaStatus: 'syncing', nebulaMessage: '正在同步到 NebulaGraph...', nebulaResult: null });
    try {
      const result = await syncToNebulaApi(currentOntology, entityInstances, relationshipInstances);
      if (result.success) {
        set({
          nebulaStatus: 'synced',
          nebulaMessage: `同步完成: ${result.vertexCount} 点, ${result.edgeCount} 边`,
          nebulaResult: result,
        });
      } else {
        set({
          nebulaStatus: 'synced',
          nebulaMessage: `nGQL 已生成 (${result.vertexCount} 点, ${result.edgeCount} 边)，nebula-console 不可用需手动执行`,
          nebulaResult: result,
        });
      }
    } catch (err) {
      set({ nebulaStatus: 'error', nebulaMessage: (err as Error).message });
    }
  },
  
  // UI Actions
  selectEntity: (id) => set({ 
    selectedEntityId: id, 
    selectedRelationshipId: null 
  }),
  
  selectRelationship: (id) => set({ 
    selectedRelationshipId: id, 
    selectedEntityId: null 
  }),
  
  setHighlightedEntities: (ids) => set({ highlightedEntities: ids }),
  setHighlightedRelationships: (ids) => set({ highlightedRelationships: ids }),
  setHighlights: (entityIds, relIds) => set({ highlightedEntities: entityIds, highlightedRelationships: relIds }),
  setGraphViewMode: (mode) => set({ graphViewMode: mode, selectedInstanceKey: null, selectedEntityId: null, selectedRelationshipId: null, highlightedEntities: [], highlightedRelationships: [] }),
  selectInstance: (key) => set({ selectedInstanceKey: key, selectedEntityId: null, selectedRelationshipId: null }),
  
  toggleDataBindings: () => set((state) => ({ showDataBindings: !state.showDataBindings })),
  setTheme: (theme) => {
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Ignore persistence errors; still update in-memory state
    }
    set({ theme, darkMode: isDarkTheme(theme) });
  },
  toggleDarkMode: () => {
    const next: ThemeId = isDarkTheme(get().theme) ? 'light' : 'dark';
    get().setTheme(next);
  },
  
  // Quest Actions
  startQuest: (questId) => {
    const { availableQuests } = get();
    const quest = availableQuests.find(q => q.id === questId);
    if (quest) {
      set({ 
        activeQuest: quest, 
        currentStepIndex: 0,
        highlightedEntities: [],
        highlightedRelationships: [],
        selectedEntityId: null,
        selectedRelationshipId: null
      });
    }
  },
  
  advanceQuestStep: () => {
    const { activeQuest, currentStepIndex } = get();
    if (activeQuest && currentStepIndex < activeQuest.steps.length - 1) {
      set({ currentStepIndex: currentStepIndex + 1 });
    } else if (activeQuest) {
      // Last step completed, complete the quest
      get().completeQuest();
    }
  },
  
  completeQuest: () => {
    const { activeQuest, completedQuests, earnedBadges, totalPoints } = get();
    if (activeQuest && !completedQuests.includes(activeQuest.id)) {
      set({
        completedQuests: [...completedQuests, activeQuest.id],
        earnedBadges: [...earnedBadges, { 
          badge: activeQuest.reward.badge, 
          icon: activeQuest.reward.badgeIcon 
        }],
        totalPoints: totalPoints + activeQuest.reward.points,
        activeQuest: null,
        currentStepIndex: 0
      });
    }
  },
  
  abandonQuest: () => set({ 
    activeQuest: null, 
    currentStepIndex: 0,
    highlightedEntities: [],
    highlightedRelationships: []
  }),
  
  // Query Actions
  setQueryInput: (input) => set({ queryInput: input }),
  setQueryResult: (result) => set({ queryResult: result }),
  clearHighlights: () => set({ highlightedEntities: [], highlightedRelationships: [] })
}));

// (HMR 注：Zustand store 初始值在模块加载时确定。
// 如果改了 store 的初始状态，请硬刷新浏览器 Ctrl+Shift+R 重新初始化。)
