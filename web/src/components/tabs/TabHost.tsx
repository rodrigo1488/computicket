"use client";

import { Component, Suspense, memo, useContext, useMemo, type ErrorInfo, type ReactNode } from "react";
import { usePathname as useNextPathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { TabActiveContext, TabRouteContext, TabsViewContext, type TabRoute } from "./context";
import { getRouteComponent, isChatLayoutPath, matchRoute } from "./routes";
import type { TabItem } from "./tabs-store";

class TabErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Erro ao renderizar aba", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-medium text-navy">Não foi possível exibir esta aba.</p>
        <p className="max-w-md text-xs text-muted">{this.state.error.message}</p>
        <button
          type="button"
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-navy hover:bg-sidebar-hover"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  }
}

const HIDDEN_STYLE = { visibility: "hidden", contentVisibility: "hidden", pointerEvents: "none" } as const;

type PaneProps = {
  tab: TabItem;
  active: boolean;
  mounted: boolean;
  userKey: string;
  /** Só para abas "nativas" (rotas fora da tabela): conteúdo renderizado pelo Next. */
  nativeChildren: ReactNode;
};

const TabPane = memo(function TabPane({ tab, active, mounted, userKey, nativeChildren }: PaneProps) {
  const match = useMemo(() => matchRoute(tab.pathname), [tab.pathname]);
  const Page = match ? getRouteComponent(match.def) : null;
  const keepAlive = match?.def.keepAlive !== false;
  const chat = isChatLayoutPath(tab.pathname);

  const route = useMemo<TabRoute>(
    () => ({ tabId: tab.id, pathname: tab.pathname, search: tab.search, params: match?.params ?? {}, userKey }),
    [tab.id, tab.pathname, tab.search, match, userKey],
  );
  const element = useMemo(() => (Page ? <Page /> : null), [Page]);

  // Abas ainda não visitadas (restauradas do storage) não montam; abas `keepAlive: false`
  // desmontam ao sair (só a URL/query é preservada).
  const render = active || (mounted && keepAlive);
  if (!render) return null;

  return (
    <div
      role="tabpanel"
      id={`tabpanel-${tab.id}`}
      aria-hidden={!active}
      inert={!active}
      data-tab-pane={tab.id}
      style={active ? undefined : HIDDEN_STYLE}
      className={cn(
        "absolute inset-0",
        chat ? "flex flex-col overflow-hidden" : "overflow-y-auto p-8",
      )}
    >
      <TabRouteContext.Provider value={route}>
        <TabActiveContext.Provider value={active}>
          <TabErrorBoundary key={tab.id} onReset={() => undefined}>
            <Suspense fallback={<p className="text-sm text-muted">Carregando…</p>}>
              {Page ? element : nativeChildren}
            </Suspense>
          </TabErrorBoundary>
        </TabActiveContext.Provider>
      </TabRouteContext.Provider>
    </div>
  );
});

/**
 * Renderiza TODAS as abas abertas, cada uma no seu próprio contêiner rolável. As inativas ficam
 * montadas porém ocultas (`visibility:hidden` + `content-visibility:hidden`, que preserva o scroll e
 * evita custo de layout/paint), então o estado React local, o scroll e os formulários sobrevivem.
 */
export function TabHost({ children }: { children: ReactNode }) {
  const view = useContext(TabsViewContext);
  const nextPathname = useNextPathname();
  if (!view) return <>{children}</>;

  return (
    <>
      {view.tabs.map((tab) => {
        const native = !matchRoute(tab.pathname);
        const active = tab.id === view.activeId;
        return (
          <TabPane
            key={tab.id}
            tab={tab}
            active={active}
            mounted={view.mountedIds.has(tab.id)}
            userKey={view.userKey}
            nativeChildren={native && active && nextPathname === tab.pathname ? children : null}
          />
        );
      })}
    </>
  );
}
