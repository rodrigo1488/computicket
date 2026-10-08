"use client";

import { useCallback, useContext, useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { TabsActionsContext, TabsViewContext } from "./context";
import { routeIcon, routeTitle } from "./routes";
import { tabHref, type TabItem } from "./tabs-store";

type MenuState = { tabId: string; x: number; y: number } | null;

function ContextMenu({
  menu,
  total,
  onClose,
}: {
  menu: NonNullable<MenuState>;
  total: number;
  onClose: () => void;
}) {
  const actions = useContext(TabsActionsContext);
  const view = useContext(TabsViewContext);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: globalThis.MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  if (!actions || !view) return null;
  const tab = view.tabs.find((t) => t.id === menu.tabId);
  if (!tab) return null;
  const item = "block w-full px-4 py-2 text-left text-sm text-navy hover:bg-sidebar-hover disabled:cursor-not-allowed disabled:opacity-40";
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", top: menu.y, left: Math.min(menu.x, window.innerWidth - 220), width: 208, zIndex: 60 }}
      className="rounded-xl border border-line bg-surface py-1 shadow-lg"
    >
      <button type="button" role="menuitem" className={item} disabled={total < 2} onClick={run(() => actions.close(tab.id))}>
        Fechar aba <span className="float-right text-xs text-muted">Alt+W</span>
      </button>
      <button type="button" role="menuitem" className={item} disabled={total < 2} onClick={run(() => actions.closeOthers(tab.id))}>
        Fechar outras abas
      </button>
      <button type="button" role="menuitem" className={item} onClick={run(() => actions.closeAll())}>
        Fechar todas as abas
      </button>
      <div className="my-1 border-t border-line" />
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={run(() => actions.openHref(tabHref(tab), { forceNew: true, fromTabId: tab.id }))}
      >
        Duplicar aba
      </button>
    </div>
  );
}

function TabButton({
  tab,
  active,
  dirty,
  closable,
  dragOver,
  onDragStateChange,
  onContextMenu,
}: {
  tab: TabItem;
  active: boolean;
  dirty: boolean;
  closable: boolean;
  dragOver: boolean;
  onDragStateChange: (overId: string | null) => void;
  onContextMenu: (e: MouseEvent, tabId: string) => void;
}) {
  const actions = useContext(TabsActionsContext);
  const view = useContext(TabsViewContext);
  if (!actions || !view) return null;
  const Icon = routeIcon(tab.pathname);
  const title = tab.title || routeTitle(tab.pathname);

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/x-tab-id", tab.id);
    e.dataTransfer.setData("text/plain", title);
  };
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("text/x-tab-id")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    onDragStateChange(tab.id);
  };
  const onDrop = (e: DragEvent) => {
    const id = e.dataTransfer.getData("text/x-tab-id");
    onDragStateChange(null);
    if (!id || id === tab.id) return;
    e.preventDefault();
    const to = view.tabs.findIndex((t) => t.id === tab.id);
    actions.move(id, to);
  };

  return (
    <div
      role="tab"
      id={`tab-${tab.id}`}
      aria-selected={active}
      aria-controls={`tabpanel-${tab.id}`}
      tabIndex={active ? 0 : -1}
      data-tab-id={tab.id}
      title={`${title}${dirty ? " (alterações não salvas)" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={() => onDragStateChange(null)}
      onDrop={onDrop}
      onDragEnd={() => onDragStateChange(null)}
      onClick={() => actions.activate(tab.id)}
      onMouseDown={(e) => {
        // Evita o "autoscroll" do botão do meio.
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && closable) {
          e.preventDefault();
          actions.close(tab.id);
        }
      }}
      onContextMenu={(e) => onContextMenu(e, tab.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          actions.activate(tab.id);
        }
      }}
      className={cn(
        "group relative flex h-9 min-w-[96px] max-w-[150px] shrink-0 cursor-pointer select-none items-center gap-2 rounded-xl px-3 text-[13px] outline-none transition-colors sm:max-w-[210px]",
        "focus-visible:ring-2 focus-visible:ring-brand/50",
        active
          ? "bg-surface font-medium text-navy shadow-sm"
          : "text-muted hover:bg-sidebar-hover hover:text-navy",
        dragOver && "ring-2 ring-brand/60",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-brand")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {dirty ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-warn-fg" aria-label="Alterações não salvas" />
      ) : null}
      {closable ? (
        <button
          type="button"
          aria-label={`Fechar aba ${title}`}
          title="Fechar aba (Alt+W)"
          draggable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            actions.close(tab.id);
          }}
          className={cn(
            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted transition-opacity hover:bg-line hover:text-navy",
            active ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** Barra de abas (estilo navegador/IDE) exibida acima do conteúdo. */
export function TabBar() {
  const view = useContext(TabsViewContext);
  const actions = useContext(TabsActionsContext);
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const activeId = view?.activeId;

  // Mantém a aba ativa visível quando a barra rola horizontalmente.
  useEffect(() => {
    if (!activeId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`);
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeId, view?.tabs.length]);

  if (!view || !actions) return null;
  const closable = view.tabs.length > 1;

  return (
    <div className="mb-2 flex shrink-0 items-center gap-2">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Abas abertas"
        title="Atalhos: Alt+W fecha a aba · Alt+PageUp/PageDown alternam · Alt+1…9 vão direto a uma aba · clique do meio fecha · arraste para reordenar"
        className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5"
        onWheel={(e) => {
          // Roda do mouse rola a barra na horizontal.
          if (e.deltaY && !e.shiftKey && listRef.current) listRef.current.scrollLeft += e.deltaY;
        }}
      >
        {view.tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === view.activeId}
            dirty={view.dirtyIds.has(tab.id)}
            closable={closable}
            dragOver={dragOverId === tab.id}
            onDragStateChange={setDragOverId}
            onContextMenu={(e, tabId) => {
              e.preventDefault();
              setMenu({ tabId, x: e.clientX, y: e.clientY });
            }}
          />
        ))}
      </div>
      {view.notice ? (
        <div
          role="status"
          className="flex max-w-[45%] shrink-0 items-start gap-2 rounded-xl bg-warn-bg px-3 py-1.5 text-xs text-warn-fg"
        >
          <span className="min-w-0">{view.notice}</span>
          <button
            type="button"
            aria-label="Dispensar aviso"
            onClick={actions.dismissNotice}
            className="shrink-0 rounded p-0.5 hover:bg-black/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      {menu ? <ContextMenu menu={menu} total={view.tabs.length} onClose={closeMenu} /> : null}
    </div>
  );
}
