"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  usePathname as useNextPathname,
  useRouter as useNextRouter,
  useSearchParams as useNextSearchParams,
} from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  TabsActionsContext,
  TabsViewContext,
  type OpenHrefOptions,
  type TabsActions,
  type TabsView,
} from "./context";
import { matchRoute, reuseSearchFor, resolveHref, routeTitle } from "./routes";
import { clearTabState, readSession, tabsStorageKey, writeSession } from "./storage";
import {
  DEFAULT_MAX_TABS,
  activateTab,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  createInitialState,
  getActiveTab,
  initState,
  moveTab,
  navigateInTab,
  openTab,
  parseHref,
  parseStoredState,
  reconcileWithUrl,
  serializeState,
  setTabTitle,
  tabHref,
  toHref,
  type TabItem,
  type TabsPolicy,
  type TabsState,
} from "./tabs-store";

const HOME_PATH = "/dashboard";
/** Aba voltando a ficar visível depois disso => refaz as queries "stale" (como o foco da janela). */
const REFRESH_AFTER_HIDDEN_MS = 15_000;
const PENDING_NAV_WINDOW_MS = 10_000;
const NOTICE_MS = 7_000;

type NavMode = "push" | "replace";

function makePolicy(): TabsPolicy {
  let last = 0;
  return {
    maxTabs: DEFAULT_MAX_TABS,
    reuseSearch: reuseSearchFor,
    homePath: HOME_PATH,
    makeId: () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    now: () => {
      last = Math.max(last + 1, Date.now());
      return last;
    },
  };
}

function tabLabel(tab: TabItem): string {
  return tab.title || routeTitle(tab.pathname);
}

export function TabsProvider({ userKey, children }: { userKey: string; children: ReactNode }) {
  const router = useNextRouter();
  const nextPathname = useNextPathname();
  const nextSearch = useNextSearchParams().toString();
  const queryClient = useQueryClient();
  const policy = useMemo(makePolicy, []);

  const [state, setState] = useState<TabsState>(() => {
    const stored = parseStoredState(readSession(tabsStorageKey(userKey)), policy.maxTabs);
    return stored
      ? initState(stored, nextPathname, nextSearch, policy)
      : createInitialState(nextPathname, nextSearch, policy);
  });
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const stateRef = useRef(state);
  const dirtyRef = useRef(dirtyIds);
  const navModeRef = useRef<NavMode>("push");
  const pendingRef = useRef<{ key: string; ts: number } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenSince = useRef(new Map<string, number>());
  const mountedRef = useRef(new Set<string>());

  const nextKey = toHref(nextPathname, nextSearch);
  const nextKeyRef = useRef(nextKey);
  nextKeyRef.current = nextKey;
  dirtyRef.current = dirtyIds;

  const activeTab = getActiveTab(state);
  const activeKey = tabHref(activeTab);
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  mountedRef.current.add(state.activeId);

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  };
  const showNoticeRef = useRef(showNotice);
  showNoticeRef.current = showNotice;

  // ------------------------------------------------------------------ ações (estáveis)
  const actions = useMemo<TabsActions>(() => {
    const commit = (next: TabsState, mode: NavMode = "push") => {
      const prev = stateRef.current;
      if (next === prev) return;
      navModeRef.current = mode;
      stateRef.current = next;
      const alive = new Set(next.tabs.map((t) => t.id));
      const removed = prev.tabs.filter((t) => !alive.has(t.id));
      if (removed.length) {
        removed.forEach((t) => {
          clearTabState(userKey, t.id);
          mountedRef.current.delete(t.id);
          hiddenSince.current.delete(t.id);
        });
        if (removed.some((t) => dirtyRef.current.has(t.id))) {
          setDirtyIds((cur) => {
            const copy = new Set(cur);
            removed.forEach((t) => copy.delete(t.id));
            return copy;
          });
        }
      }
      if (next.activeId !== prev.activeId) hiddenSince.current.set(prev.activeId, Date.now());
      setState(next);
    };

    const reportEvicted = (evicted: TabItem[]) => {
      if (!evicted.length) return;
      const names = evicted.map((t) => `“${tabLabel(t)}”`).join(", ");
      showNoticeRef.current(
        `Limite de ${policy.maxTabs} abas: ${names} ${evicted.length > 1 ? "foram fechadas" : "foi fechada"} (a mais antiga sem uso) para liberar memória.`,
      );
    };

    const openHref = (href: string, options: OpenHrefOptions = {}) => {
      const target = resolveHref(href);
      const { pathname } = parseHref(target);
      if (!matchRoute(pathname)) {
        // Rota fora da tabela (ex.: 404): navegação normal do Next; a URL é reconciliada depois.
        router.push(target);
        return;
      }
      const res = openTab(stateRef.current, target, policy, {
        forceNew: options.forceNew,
        openerId: options.fromTabId,
        protectedIds: dirtyRef.current,
      });
      if (res.rejected) {
        showNoticeRef.current(
          `Limite de ${policy.maxTabs} abas atingido e todas as outras têm alterações não salvas. Feche ou salve uma aba para abrir outra.`,
        );
        return;
      }
      reportEvicted(res.evicted);
      commit(res.state, "push");
    };

    const confirmClose = (ids: string[]): boolean => {
      const dirty = ids.filter((id) => dirtyRef.current.has(id));
      if (!dirty.length) return true;
      const labels = stateRef.current.tabs
        .filter((t) => dirty.includes(t.id))
        .map((t) => `“${tabLabel(t)}”`)
        .join(", ");
      return window.confirm(`Há alterações não salvas em ${labels}. Fechar mesmo assim?`);
    };

    return {
      openHref,
      navigateTab: (tabId, href) => {
        const target = resolveHref(href);
        const { pathname } = parseHref(target);
        if (!matchRoute(pathname)) {
          router.replace(target);
          return;
        }
        const res = navigateInTab(stateRef.current, tabId, target, policy);
        commit(res.state, "replace");
      },
      goBack: (tabId) => {
        const s = stateRef.current;
        const tab = s.tabs.find((t) => t.id === tabId);
        if (tab?.openerId && s.tabs.some((t) => t.id === tab.openerId)) {
          commit(closeTab(s, tabId, policy), "replace");
        } else {
          window.history.back();
        }
      },
      activate: (tabId) => commit(activateTab(stateRef.current, tabId, policy), "push"),
      close: (tabId, options) => {
        if (!options?.force && !confirmClose([tabId])) return;
        commit(closeTab(stateRef.current, tabId, policy), "replace");
      },
      closeOthers: (tabId) => {
        const others = stateRef.current.tabs.filter((t) => t.id !== tabId).map((t) => t.id);
        if (!confirmClose(others)) return;
        commit(closeOtherTabs(stateRef.current, tabId, policy), "replace");
      },
      closeAll: () => {
        if (!confirmClose(stateRef.current.tabs.map((t) => t.id))) return;
        commit(closeAllTabs(stateRef.current, policy), "replace");
      },
      move: (tabId, toIndex) => commit(moveTab(stateRef.current, tabId, toIndex), "push"),
      setTabTitle: (tabId, title) => commit(setTabTitle(stateRef.current, tabId, title), "push"),
      setTabDirty: (tabId, dirty) => {
        setDirtyIds((cur) => {
          if (cur.has(tabId) === dirty) return cur;
          const copy = new Set(cur);
          if (dirty) copy.add(tabId);
          else copy.delete(tabId);
          return copy;
        });
      },
      dismissNotice: () => setNotice(null),
    };
  }, [policy, router, userKey]);

  // ------------------------------------------------------------------ store -> URL
  useEffect(() => {
    if (activeKey === nextKeyRef.current) return;
    const mode = navModeRef.current;
    navModeRef.current = "push";
    pendingRef.current = { key: activeKey, ts: Date.now() };
    if (mode === "replace") router.replace(activeKey, { scroll: false });
    else router.push(activeKey, { scroll: false });
  }, [activeKey, router]);

  // ------------------------------------------------------------------ URL -> store (Voltar/Avançar, link nativo)
  useEffect(() => {
    const pending = pendingRef.current;
    if (pending) {
      if (pending.key === nextKey) {
        pendingRef.current = null;
        return;
      }
      // Navegação intermediária de um clique anterior: ignora.
      if (Date.now() - pending.ts < PENDING_NAV_WINDOW_MS) return;
      pendingRef.current = null;
    }
    if (nextKey === activeKeyRef.current) return;
    const { pathname, search } = parseHref(nextKey);
    const res = reconcileWithUrl(stateRef.current, pathname, search, policy, dirtyRef.current);
    if (res.rejected) {
      showNoticeRef.current("Limite de abas atingido: não foi possível abrir esta página em uma nova aba.");
      return;
    }
    if (res.evicted.length) {
      const names = res.evicted.map((t) => `“${tabLabel(t)}”`).join(", ");
      showNoticeRef.current(`Limite de ${policy.maxTabs} abas: ${names} fechada(s) para liberar memória.`);
    }
    const prev = stateRef.current;
    stateRef.current = res.state;
    const alive = new Set(res.state.tabs.map((t) => t.id));
    prev.tabs.filter((t) => !alive.has(t.id)).forEach((t) => {
      clearTabState(userKey, t.id);
      mountedRef.current.delete(t.id);
    });
    if (res.state.activeId !== prev.activeId) hiddenSince.current.set(prev.activeId, Date.now());
    navModeRef.current = "push";
    setState(res.state);
  }, [nextKey, policy, userKey]);

  // ------------------------------------------------------------------ persistência
  useEffect(() => {
    writeSession(tabsStorageKey(userKey), serializeState(state));
  }, [state, userKey]);

  // ------------------------------------------------------------------ dados frescos ao voltar para uma aba
  const lastActiveId = useRef(state.activeId);
  useEffect(() => {
    if (lastActiveId.current === state.activeId) return;
    const since = hiddenSince.current.get(state.activeId);
    lastActiveId.current = state.activeId;
    hiddenSince.current.delete(state.activeId);
    if (since && Date.now() - since > REFRESH_AFTER_HIDDEN_MS) {
      void queryClient.refetchQueries({ type: "active", stale: true });
    }
  }, [state.activeId, queryClient]);

  // ------------------------------------------------------------------ atalhos de teclado
  useEffect(() => {
    const isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      const editable =
        !!target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
      // No Mac, Option+tecla digita caracteres especiais: não intercepta dentro de campos.
      if (isMac && editable) return;
      const s = stateRef.current;
      const idx = s.tabs.findIndex((t) => t.id === s.activeId);
      const code = event.code;
      if (code === "KeyW") {
        event.preventDefault();
        actions.close(s.activeId);
      } else if (code === "PageUp" || code === "PageDown") {
        if (s.tabs.length < 2) return;
        event.preventDefault();
        const step = code === "PageDown" ? 1 : -1;
        actions.activate(s.tabs[(idx + step + s.tabs.length) % s.tabs.length].id);
      } else if (/^Digit[1-9]$/.test(code)) {
        const n = Number(code.slice(5)) - 1;
        // Alt+9 = última aba (como nos navegadores).
        const tab = n === 8 ? s.tabs[s.tabs.length - 1] : s.tabs[n];
        if (!tab) return;
        event.preventDefault();
        actions.activate(tab.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const view = useMemo<TabsView>(
    () => ({
      tabs: state.tabs,
      activeId: state.activeId,
      mountedIds: mountedRef.current,
      dirtyIds,
      notice,
      maxTabs: policy.maxTabs,
      userKey,
    }),
    [state, dirtyIds, notice, policy.maxTabs, userKey],
  );

  return (
    <TabsActionsContext.Provider value={actions}>
      <TabsViewContext.Provider value={view}>{children}</TabsViewContext.Provider>
    </TabsActionsContext.Provider>
  );
}
