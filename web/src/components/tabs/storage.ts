/** Persistência das abas em `sessionStorage` (por usuário; apagada no logout). */

export const TABS_KEY_PREFIX = "computicket.tabs.v1:";
export const TABSTATE_KEY_PREFIX = "computicket.tabstate.v1:";

export function tabsStorageKey(userKey: string): string {
  return `${TABS_KEY_PREFIX}${userKey}`;
}

function tabStatePrefix(userKey: string, tabId: string): string {
  return `${TABSTATE_KEY_PREFIX}${userKey}:${tabId}:`;
}

export function tabStateStorageKey(userKey: string, tabId: string, key: string): string {
  return `${tabStatePrefix(userKey, tabId)}${key}`;
}

function safeSession(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readSession(key: string): string | null {
  try {
    return safeSession()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: string): void {
  try {
    safeSession()?.setItem(key, value);
  } catch {
    // quota cheia / modo privado: persistência é só um bônus.
  }
}

function removeByPrefix(prefix: string): void {
  const store = safeSession();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach((k) => store.removeItem(k));
  } catch {
    // ignora
  }
}

/** Remove o estado serializável guardado por `useTabState` para uma aba fechada. */
export function clearTabState(userKey: string, tabId: string): void {
  removeByPrefix(tabStatePrefix(userKey, tabId));
}

/** Logout: apaga a lista de abas e o estado de todas elas (de qualquer usuário). */
export function clearAllTabsStorage(): void {
  removeByPrefix(TABS_KEY_PREFIX);
  removeByPrefix(TABSTATE_KEY_PREFIX);
}
