"use client";

/**
 * Substitutos "cientes de abas" de `next/navigation` e `next/link`.
 *
 * As páginas do grupo `(app)` ficam montadas dentro de abas e, portanto, não podem depender da URL
 * global do navegador (que sempre reflete só a aba ativa). Estes hooks leem pathname/query/params da
 * ABA que contém o componente e transformam `router.push/replace/back` e `<Link>` em operações de
 * abas. Fora de uma aba (ex.: sidebar, notificações) delegam ao Next/abas ativas.
 *
 * Uso: `import { useRouter, useSearchParams, useParams, usePathname, Link } from "@/components/tabs/navigation";`
 */

import {
  forwardRef,
  useContext,
  useMemo,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
} from "react";
import NextLink from "next/link";
import {
  ReadonlyURLSearchParams,
  useParams as useNextParams,
  usePathname as useNextPathname,
  useRouter as useNextRouter,
  useSearchParams as useNextSearchParams,
} from "next/navigation";
import {
  TabRouteContext,
  TabsActionsContext,
  TabsViewContext,
  type TabRoute,
  type TabsActions,
} from "./context";
import { matchRoute, resolveHref } from "./routes";
import { parseHref } from "./tabs-store";

function isAppHref(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  return matchRoute(parseHref(resolveHref(href)).pathname) !== null;
}

type RouteRef = Pick<TabRoute, "tabId" | "pathname">;

function goTo(actions: TabsActions, route: RouteRef | null, href: string, forceNew = false, replace = false) {
  const resolved = resolveHref(href);
  if (!forceNew && route && (replace || parseHref(resolved).pathname === route.pathname)) {
    // Mesma tela com outra query (filtros na URL) ou `replace`: atualiza a própria aba.
    actions.navigateTab(route.tabId, resolved);
    return;
  }
  actions.openHref(resolved, { forceNew, fromTabId: route?.tabId });
}

export function usePathname(): string {
  const route = useContext(TabRouteContext);
  const view = useContext(TabsViewContext);
  const inTabs = route !== null || view !== null;
  // `inTabs` é constante durante a vida do componente (depende só de onde ele está na árvore),
  // então a ordem dos hooks não muda. Dentro de uma aba evitamos assinar a URL global do Next
  // para não re-renderizar todas as abas a cada troca.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const nextPathname = inTabs ? null : useNextPathname();
  if (route) return route.pathname;
  if (view) return view.tabs.find((t) => t.id === view.activeId)?.pathname ?? "/";
  return nextPathname ?? "/";
}

export function useSearchParams(): ReadonlyURLSearchParams {
  const route = useContext(TabRouteContext);
  const view = useContext(TabsViewContext);
  const inTabs = route !== null || view !== null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const nextParams = inTabs ? null : useNextSearchParams();
  const search = route ? route.search : (view?.tabs.find((t) => t.id === view.activeId)?.search ?? "");
  const own = useMemo(() => new ReadonlyURLSearchParams(new URLSearchParams(search)), [search]);
  return inTabs ? own : (nextParams ?? own);
}

export function useParams<T extends Record<string, string | string[]> = Record<string, string | string[]>>(): T {
  const route = useContext(TabRouteContext);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const nextParams = route ? null : useNextParams<T>();
  return (route ? (route.params as unknown as T) : nextParams) as T;
}

export function useRouter(): ReturnType<typeof useNextRouter> {
  const nextRouter = useNextRouter();
  const actions = useContext(TabsActionsContext);
  const route = useContext(TabRouteContext);
  const tabId = route?.tabId;
  const pathname = route?.pathname;
  return useMemo(() => {
    if (!actions) return nextRouter;
    const ctx: RouteRef | null = tabId && pathname ? { tabId, pathname } : null;
    return {
      ...nextRouter,
      push: (href: string) => {
        if (isAppHref(href)) goTo(actions, ctx, href);
        else nextRouter.push(href);
      },
      replace: (href: string) => {
        if (!isAppHref(href)) {
          nextRouter.replace(href);
        } else if (ctx) {
          actions.navigateTab(ctx.tabId, href);
        } else {
          actions.openHref(href);
        }
      },
      back: () => {
        if (ctx) actions.goBack(ctx.tabId);
        else nextRouter.back();
      },
    };
  }, [actions, nextRouter, tabId, pathname]);
}

type LinkProps = ComponentProps<typeof NextLink>;

/**
 * `<Link>` que abre/ativa abas. Clique normal = abre (ou ativa a aba existente da rota);
 * Ctrl/Cmd+clique ou botão do meio = força uma nova aba; Shift+clique / Alt+clique / target=_blank
 * mantêm o comportamento nativo do navegador.
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function TabLink(
  { href, onClick, onAuxClick, target, replace, ...rest },
  ref,
) {
  const actions = useContext(TabsActionsContext);
  const route = useContext(TabRouteContext);
  const internal = typeof href === "string" && isAppHref(href) ? href : null;

  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || !actions || !internal) return;
    if (event.button !== 0 || event.shiftKey || event.altKey) return;
    if (target && target !== "_self") return;
    event.preventDefault();
    goTo(actions, route, internal, event.ctrlKey || event.metaKey, replace === true);
  };

  const handleAuxClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    onAuxClick?.(event);
    if (event.defaultPrevented || !actions || !internal) return;
    if (event.button !== 1) return;
    event.preventDefault();
    actions.openHref(resolveHref(internal), { forceNew: true, fromTabId: route?.tabId });
  };

  return (
    <NextLink
      ref={ref}
      href={href}
      target={target}
      replace={replace}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      {...rest}
    />
  );
});
