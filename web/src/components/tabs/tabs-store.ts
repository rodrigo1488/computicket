/**
 * Lógica PURA do sistema de abas (sem React, sem imports com alias) para poder ser
 * testada com `node --test` e reutilizada pelo `TabsProvider`.
 *
 * Todas as funções são imutáveis: recebem um `TabsState` e devolvem um novo estado.
 */

export type TabItem = {
  id: string;
  /** Caminho sem query/hash e sem barra final (ex.: `/tickets/12`). */
  pathname: string;
  /** Query string sem o `?` inicial (ex.: `status=aberto`). */
  search: string;
  /** Título escolhido pela página (`useTabTitle`); quando ausente usa o título da rota. */
  title?: string;
  /** Aba que originou esta (para voltar a ela ao fechar). */
  openerId?: string;
  /** Marca de ordem de uso (maior = mais recente). */
  lastActiveAt: number;
};

export type TabsState = {
  tabs: TabItem[];
  activeId: string;
};

export type TabsPolicy = {
  maxTabs: number;
  /** Rotas cujo estado interno vive na query: um link com query reaproveita a aba existente. */
  reuseSearch: (pathname: string) => boolean;
  /** Rota aberta quando a última aba é fechada / "fechar todas". */
  homePath: string;
  makeId: () => string;
  now: () => number;
};

export const DEFAULT_MAX_TABS = 12;
export const STORAGE_VERSION = 1;

// ---------------------------------------------------------------- helpers de URL

export function normalizePathname(pathname: string): string {
  let p = pathname.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/, "");
  return p || "/";
}

export function normalizeSearch(search: string): string {
  let s = search.trim();
  if (s.startsWith("?")) s = s.slice(1);
  return s;
}

export function parseHref(href: string): { pathname: string; search: string } {
  let raw = href.trim();
  const hash = raw.indexOf("#");
  if (hash >= 0) raw = raw.slice(0, hash);
  // URLs absolutas do mesmo site: usa só path+query.
  const abs = /^[a-z][a-z0-9+.-]*:\/\/[^/]+/i.exec(raw);
  if (abs) raw = raw.slice(abs[0].length) || "/";
  const q = raw.indexOf("?");
  const path = q >= 0 ? raw.slice(0, q) : raw;
  const search = q >= 0 ? raw.slice(q + 1) : "";
  return { pathname: normalizePathname(path || "/"), search: normalizeSearch(search) };
}

export function toHref(pathname: string, search: string): string {
  return search ? `${pathname}?${search}` : pathname;
}

export function tabHref(tab: Pick<TabItem, "pathname" | "search">): string {
  return toHref(tab.pathname, tab.search);
}

// ---------------------------------------------------------------- consultas

export function getActiveTab(state: TabsState): TabItem {
  return state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];
}

function mostRecent(tabs: TabItem[]): TabItem | undefined {
  return tabs.reduce<TabItem | undefined>((best, t) => (!best || t.lastActiveAt > best.lastActiveAt ? t : best), undefined);
}

/**
 * Procura a aba que deve ser reaproveitada para um destino.
 * - com query: mesma rota + mesma query; ou (rotas `reuseSearch`) a aba mais recente da rota;
 * - sem query: a aba "limpa" da rota ou, na falta, a mais recente da rota.
 */
export function findTabForTarget(
  state: TabsState,
  pathname: string,
  search: string,
  policy: Pick<TabsPolicy, "reuseSearch">,
  excludeId?: string,
): TabItem | undefined {
  const same = state.tabs.filter((t) => t.pathname === pathname && t.id !== excludeId);
  if (!same.length) return undefined;
  if (search) {
    const exact = same.find((t) => t.search === search);
    if (exact) return exact;
    return policy.reuseSearch(pathname) ? mostRecent(same) : undefined;
  }
  return mostRecent(same.filter((t) => !t.search)) ?? mostRecent(same);
}

// ---------------------------------------------------------------- criação / ativação

function touch(state: TabsState, id: string, now: number): TabsState {
  return {
    activeId: id,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, lastActiveAt: now } : t)),
  };
}

export function createInitialState(pathname: string, search: string, policy: TabsPolicy): TabsState {
  const id = policy.makeId();
  return {
    activeId: id,
    tabs: [{ id, pathname: normalizePathname(pathname), search: normalizeSearch(search), lastActiveAt: policy.now() }],
  };
}

export function activateTab(state: TabsState, id: string, policy: Pick<TabsPolicy, "now">): TabsState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return touch(state, id, policy.now());
}

export type OpenResult = {
  state: TabsState;
  /** Aba ativa após a operação (é a mesma de antes quando `rejected`). */
  tabId: string;
  created: boolean;
  /** Abas descartadas por causa do limite. */
  evicted: TabItem[];
  /** Limite atingido e nenhuma aba pôde ser descartada (todas protegidas). */
  rejected: boolean;
};

export type OpenOptions = {
  /** Cria nova aba mesmo que a rota já esteja aberta (Ctrl/Cmd+clique, botão do meio). */
  forceNew?: boolean;
  openerId?: string;
  title?: string;
  /** Abas que nunca podem ser descartadas (ex.: com alterações não salvas). */
  protectedIds?: ReadonlySet<string>;
};

function evictOne(state: TabsState, protectedIds: ReadonlySet<string> | undefined): TabItem | undefined {
  const candidates = state.tabs.filter((t) => t.id !== state.activeId && !protectedIds?.has(t.id));
  return candidates.reduce<TabItem | undefined>(
    (oldest, t) => (!oldest || t.lastActiveAt < oldest.lastActiveAt ? t : oldest),
    undefined,
  );
}

function insertAfter(tabs: TabItem[], afterId: string | undefined, tab: TabItem): TabItem[] {
  const idx = afterId ? tabs.findIndex((t) => t.id === afterId) : -1;
  if (idx < 0) return [...tabs, tab];
  return [...tabs.slice(0, idx + 1), tab, ...tabs.slice(idx + 1)];
}

/** Abre (ou ativa) a aba de `href`. */
export function openTab(state: TabsState, href: string, policy: TabsPolicy, options: OpenOptions = {}): OpenResult {
  const { pathname, search } = parseHref(href);

  if (!options.forceNew) {
    const found = findTabForTarget(state, pathname, search, policy);
    if (found) {
      let next = touch(state, found.id, policy.now());
      if (search && found.search !== search) {
        next = { ...next, tabs: next.tabs.map((t) => (t.id === found.id ? { ...t, search } : t)) };
      }
      return { state: next, tabId: found.id, created: false, evicted: [], rejected: false };
    }
  }

  let working = state;
  const evicted: TabItem[] = [];
  while (working.tabs.length >= policy.maxTabs) {
    const victim = evictOne(working, options.protectedIds);
    if (!victim) return { state, tabId: state.activeId, created: false, evicted: [], rejected: true };
    evicted.push(victim);
    working = { ...working, tabs: working.tabs.filter((t) => t.id !== victim.id) };
  }

  const id = policy.makeId();
  const opener = options.openerId ?? working.activeId;
  const tab: TabItem = {
    id,
    pathname,
    search,
    title: options.title,
    openerId: working.tabs.some((t) => t.id === opener) ? opener : undefined,
    lastActiveAt: policy.now(),
  };
  return {
    state: { tabs: insertAfter(working.tabs, opener, tab), activeId: id },
    tabId: id,
    created: true,
    evicted,
    rejected: false,
  };
}

// ---------------------------------------------------------------- fechamento

function pickNeighbor(tabs: TabItem[], closing: TabItem, index: number): TabItem | undefined {
  const rest = tabs.filter((t) => t.id !== closing.id);
  if (closing.openerId) {
    const opener = rest.find((t) => t.id === closing.openerId);
    if (opener) return opener;
  }
  return tabs[index + 1] ?? tabs[index - 1] ?? rest[0];
}

function clearOpener(tabs: TabItem[], removedId: string): TabItem[] {
  return tabs.map((t) => (t.openerId === removedId ? { ...t, openerId: undefined } : t));
}

/**
 * Fecha uma aba. Se for a ativa, ativa a de origem (opener) ou a vizinha.
 * Fechar a única aba existente a transforma em `homePath` (nunca fica sem abas);
 * se ela já for a `homePath`, nada acontece.
 */
export function closeTab(state: TabsState, id: string, policy: TabsPolicy): TabsState {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index < 0) return state;
  const closing = state.tabs[index];

  if (state.tabs.length === 1) {
    if (closing.pathname === policy.homePath && !closing.search) return state;
    const home: TabItem = { id: policy.makeId(), pathname: policy.homePath, search: "", lastActiveAt: policy.now() };
    return { tabs: [home], activeId: home.id };
  }

  const remaining = clearOpener(
    state.tabs.filter((t) => t.id !== id),
    id,
  );
  if (state.activeId !== id) return { ...state, tabs: remaining };

  const target = pickNeighbor(state.tabs, closing, index);
  const activeId = target ? target.id : remaining[0].id;
  return touch({ tabs: remaining, activeId }, activeId, policy.now());
}

export function closeOtherTabs(state: TabsState, keepId: string, policy: Pick<TabsPolicy, "now">): TabsState {
  if (!state.tabs.some((t) => t.id === keepId)) return state;
  return touch(
    { tabs: state.tabs.filter((t) => t.id === keepId).map((t) => ({ ...t, openerId: undefined })), activeId: keepId },
    keepId,
    policy.now(),
  );
}

/** Fecha todas e deixa apenas a aba inicial (`homePath`). */
export function closeAllTabs(state: TabsState, policy: TabsPolicy): TabsState {
  const existing = state.tabs.find((t) => t.pathname === policy.homePath && !t.search);
  if (existing) return closeOtherTabs(state, existing.id, policy);
  const home: TabItem = { id: policy.makeId(), pathname: policy.homePath, search: "", lastActiveAt: policy.now() };
  return { tabs: [home], activeId: home.id };
}

// ---------------------------------------------------------------- edição

export function moveTab(state: TabsState, id: string, toIndex: number): TabsState {
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from < 0) return state;
  const to = Math.max(0, Math.min(toIndex, state.tabs.length - 1));
  if (from === to) return state;
  const tabs = [...state.tabs];
  const [item] = tabs.splice(from, 1);
  tabs.splice(to, 0, item);
  return { ...state, tabs };
}

export function setTabSearch(state: TabsState, id: string, search: string): TabsState {
  const clean = normalizeSearch(search);
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || tab.search === clean) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, search: clean } : t)) };
}

export function setTabTitle(state: TabsState, id: string, title: string | undefined): TabsState {
  const clean = title?.trim() || undefined;
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || tab.title === clean) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, title: clean } : t)) };
}

export type NavigateResult = { state: TabsState; activeId: string; closedId?: string };

/**
 * Navegação "dentro da aba" (router.replace): a aba passa a apontar para `href`.
 * - mesma rota: só troca a query;
 * - rota diferente já aberta em outra aba: ativa a existente e descarta esta (evita duplicata);
 * - senão: a própria aba muda de rota (a página é remontada).
 */
export function navigateInTab(state: TabsState, tabId: string, href: string, policy: TabsPolicy): NavigateResult {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return { state, activeId: state.activeId };
  const { pathname, search } = parseHref(href);

  if (tab.pathname === pathname) {
    return { state: setTabSearch(state, tabId, search), activeId: state.activeId };
  }

  const existing = findTabForTarget(state, pathname, search, policy, tabId);
  if (existing) {
    const wasActive = state.activeId === tabId;
    const tabs = clearOpener(
      state.tabs
        .filter((t) => t.id !== tabId)
        .map((t) =>
          t.id === existing.id
            ? { ...t, search: search || t.search, lastActiveAt: wasActive ? policy.now() : t.lastActiveAt }
            : t,
        ),
      tabId,
    );
    const activeId = wasActive ? existing.id : state.activeId;
    return { state: { tabs, activeId }, activeId, closedId: tabId };
  }

  const morphed = state.tabs.map((t) =>
    t.id === tabId ? { ...t, pathname, search, title: undefined, lastActiveAt: policy.now() } : t,
  );
  return { state: { ...state, tabs: morphed }, activeId: state.activeId };
}

// ---------------------------------------------------------------- reconciliação com a URL

export type ReconcileResult = { state: TabsState; evicted: TabItem[]; rejected: boolean };

/**
 * A URL mudou "por fora" (botão Voltar/Avançar, link nativo, deep link): faz o estado
 * das abas refletir a URL (ativa a aba correspondente ou cria uma).
 */
export function reconcileWithUrl(
  state: TabsState,
  pathname: string,
  search: string,
  policy: TabsPolicy,
  protectedIds?: ReadonlySet<string>,
): ReconcileResult {
  const p = normalizePathname(pathname);
  const s = normalizeSearch(search);
  const active = getActiveTab(state);
  if (active.pathname === p) {
    return { state: setTabSearch(state, active.id, s), evicted: [], rejected: false };
  }
  const same = state.tabs.filter((t) => t.pathname === p);
  const target = same.find((t) => t.search === s) ?? mostRecent(same);
  if (target) {
    return { state: setTabSearch(touch(state, target.id, policy.now()), target.id, s), evicted: [], rejected: false };
  }
  const res = openTab(state, toHref(p, s), policy, { forceNew: true, protectedIds });
  return { state: res.state, evicted: res.evicted, rejected: res.rejected };
}

// ---------------------------------------------------------------- persistência

type Stored = { v: number; activeId: string; tabs: TabItem[] };

export function serializeState(state: TabsState): string {
  const payload: Stored = { v: STORAGE_VERSION, activeId: state.activeId, tabs: state.tabs };
  return JSON.stringify(payload);
}

function isTabItem(value: unknown): value is TabItem {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.pathname === "string" &&
    t.pathname.startsWith("/") &&
    typeof t.search === "string" &&
    typeof t.lastActiveAt === "number" &&
    (t.title === undefined || typeof t.title === "string") &&
    (t.openerId === undefined || typeof t.openerId === "string")
  );
}

/** Lê o estado salvo; devolve `null` se ausente/corrompido/versão diferente. */
export function parseStoredState(raw: string | null | undefined, maxTabs = DEFAULT_MAX_TABS): TabsState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<Stored>;
    if (!data || data.v !== STORAGE_VERSION || !Array.isArray(data.tabs)) return null;
    const seen = new Set<string>();
    const tabs: TabItem[] = [];
    for (const item of data.tabs) {
      if (!isTabItem(item) || seen.has(item.id)) continue;
      seen.add(item.id);
      tabs.push(item);
      if (tabs.length >= maxTabs) break;
    }
    if (!tabs.length) return null;
    const ids = new Set(tabs.map((t) => t.id));
    const cleaned = tabs.map((t) => (t.openerId && !ids.has(t.openerId) ? { ...t, openerId: undefined } : t));
    const activeId = typeof data.activeId === "string" && ids.has(data.activeId) ? data.activeId : cleaned[0].id;
    return { tabs: cleaned, activeId };
  } catch {
    return null;
  }
}

/**
 * Estado inicial: restaura o salvo (se houver) e garante que a URL atual (deep link / F5)
 * corresponda à aba ativa.
 */
export function initState(
  stored: TabsState | null,
  pathname: string,
  search: string,
  policy: TabsPolicy,
): TabsState {
  if (!stored) return createInitialState(pathname, search, policy);
  return reconcileWithUrl(stored, pathname, search, policy).state;
}
