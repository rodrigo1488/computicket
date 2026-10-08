"use client";

import { createContext } from "react";
import type { RouteParams } from "./routes";
import type { TabItem } from "./tabs-store";

export type OpenHrefOptions = {
  /** Cria uma nova aba mesmo que a rota já esteja aberta. */
  forceNew?: boolean;
  /** Aba de origem (para voltar a ela ao fechar). Padrão: a aba ativa. */
  fromTabId?: string;
};

/** Ações (identidade estável: nunca mudam entre renders). */
export type TabsActions = {
  /** Abre ou ativa a aba da rota (equivalente a clicar num link/`router.push`). */
  openHref: (href: string, options?: OpenHrefOptions) => void;
  /** Navega DENTRO da aba (equivalente a `router.replace`). */
  navigateTab: (tabId: string, href: string) => void;
  /** `router.back()` dentro de uma aba: fecha a aba e volta à de origem. */
  goBack: (tabId: string) => void;
  activate: (tabId: string) => void;
  close: (tabId: string, options?: { force?: boolean }) => void;
  closeOthers: (tabId: string) => void;
  closeAll: () => void;
  move: (tabId: string, toIndex: number) => void;
  setTabTitle: (tabId: string, title: string | undefined) => void;
  setTabDirty: (tabId: string, dirty: boolean) => void;
  dismissNotice: () => void;
};

/** Estado observável (muda quando abas são abertas/fechadas/ativadas). */
export type TabsView = {
  tabs: TabItem[];
  activeId: string;
  /** Abas que já foram ativadas nesta sessão (as restauradas do storage só montam ao serem abertas). */
  mountedIds: ReadonlySet<string>;
  dirtyIds: ReadonlySet<string>;
  notice: string | null;
  maxTabs: number;
  userKey: string;
};

export type TabRoute = {
  tabId: string;
  pathname: string;
  search: string;
  params: RouteParams;
  /** Chave do usuário (para chaves de storage por aba). */
  userKey: string;
};

export const TabsActionsContext = createContext<TabsActions | null>(null);
export const TabsViewContext = createContext<TabsView | null>(null);
/** Só existe dentro do conteúdo de uma aba. */
export const TabRouteContext = createContext<TabRoute | null>(null);
/** `true` quando a aba que contém o componente é a ativa (e fora de abas). */
export const TabActiveContext = createContext<boolean>(true);
