"use client";

import { useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { TabActiveContext, TabRouteContext, TabsActionsContext } from "./context";
import { readSession, tabStateStorageKey, writeSession } from "./storage";

/**
 * `true` quando a aba que contém o componente é a ativa (e sempre `true` fora de abas).
 * Use para pausar polling/sockets/timers enquanto a aba está em segundo plano:
 * `refetchInterval: isActive ? 15_000 : false`.
 */
export function useIsActiveTab(): boolean {
  return useContext(TabActiveContext);
}

/** Executa `callback` toda vez que a aba volta a ficar ativa (não roda na primeira montagem). */
export function useOnTabActivated(callback: () => void): void {
  const isActive = useIsActiveTab();
  const cb = useRef(callback);
  cb.current = callback;
  const was = useRef(isActive);
  useEffect(() => {
    if (isActive && !was.current) cb.current();
    was.current = isActive;
  }, [isActive]);
}

/** Define o título da aba (ex.: `Ticket #12 · Cliente X`). `undefined` volta ao título da rota. */
export function useTabTitle(title: string | undefined | null): void {
  const route = useContext(TabRouteContext);
  const actions = useContext(TabsActionsContext);
  const tabId = route?.tabId;
  const clean = title?.trim() || undefined;
  useEffect(() => {
    if (!tabId || !actions || !clean) return;
    actions.setTabTitle(tabId, clean);
  }, [actions, tabId, clean]);
}

/**
 * Marca a aba com "alterações não salvas": mostra um indicador, pede confirmação ao fechar
 * e impede que seja descartada automaticamente pelo limite de abas.
 */
export function useTabDirty(dirty: boolean): void {
  const route = useContext(TabRouteContext);
  const actions = useContext(TabsActionsContext);
  const tabId = route?.tabId;
  useEffect(() => {
    if (!tabId || !actions) return;
    actions.setTabDirty(tabId, dirty);
    return () => actions.setTabDirty(tabId, false);
  }, [actions, tabId, dirty]);
}

function resolveInitial<T>(initial: T | (() => T)): T {
  return typeof initial === "function" ? (initial as () => T)() : initial;
}

/**
 * Como `useState`, mas o valor (JSON-serializável) também é guardado em `sessionStorage`
 * por aba, então sobrevive a F5. Dentro de uma aba já montada o estado sobrevive de qualquer forma
 * (a página fica montada); este hook cobre o recarregamento da página.
 * Fora de uma aba comporta-se como `useState`.
 */
export function useTabState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const route = useContext(TabRouteContext);
  const storageKey = route ? tabStateStorageKey(route.userKey, route.tabId, key) : null;
  const [value, setValue] = useState<T>(() => {
    if (storageKey) {
      const raw = readSession(storageKey);
      if (raw != null) {
        try {
          return JSON.parse(raw) as T;
        } catch {
          // valor corrompido: usa o inicial
        }
      }
    }
    return resolveInitial(initial);
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!storageKey) return;
    try {
      writeSession(storageKey, JSON.stringify(value));
    } catch {
      // não serializável: ignora
    }
  }, [storageKey, value]);
  return [value, setValue];
}

/** Acesso às ações da barra de abas (abrir/fechar), ou `null` fora do `TabsProvider`. */
export function useTabsActions() {
  return useContext(TabsActionsContext);
}
