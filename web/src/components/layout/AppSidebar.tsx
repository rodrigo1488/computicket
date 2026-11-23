"use client";

import { Link, usePathname } from "@/components/tabs/navigation";
import { useQuery } from "@tanstack/react-query";
import { Headset, LogOut, Menu, MessageCircle, Ticket, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { flask } from "@/lib/api";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { ProfileDialog } from "@/components/profile/ProfileDialog";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

const SIDEBAR_KEY = "computicket.sidebar";
const STALE_POLL_MS = 90_000;
const HELPDESK_POLL_MS = 15_000;
const MOBILE_PRIMARY_HREFS = new Set(["/helpdesk", "/chat", "/tickets"]);

function NavAlertBadge({
  count,
  collapsed,
  label,
}: {
  count: number;
  collapsed?: boolean;
  label: string;
}) {
  if (count <= 0) return null;
  const text = count > 99 ? "99+" : String(count);
  return (
    <span
      className={cn(
        "inline-flex min-w-4.5 items-center justify-center rounded-full bg-open px-1.5 text-[10px] font-bold leading-4.5 text-white",
        collapsed && "absolute -right-1.5 -top-1.5 min-w-4 px-1 leading-4",
      )}
      aria-label={label}
    >
      {text}
    </span>
  );
}

function readCollapsed() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_KEY) === "collapsed";
}

function isNavItemActive(pathname: string, href: string) {
  return (
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === "/configuracoes" && pathname.startsWith("/automacao"))
  );
}

export function AppSidebar({ collapsed: controlledCollapsed }: { collapsed?: boolean } = {}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [internalCollapsed] = useState(readCollapsed);
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [collapsed]);

  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [pathname]);

  const role = (user?.role || "").toLowerCase();
  const isAdmin = ["admin", "administrador", "administrator"].includes(role);
  const isTech = isAdmin || role === "tecnico";

  const items = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.techOnly && !isTech) return false;
    return true;
  });

  const mobileRestItems = items.filter((item) => !MOBILE_PRIMARY_HREFS.has(item.href));
  const isRestRouteActive = mobileRestItems.some((item) => isNavItemActive(pathname, item.href));

  const stale = useQuery({
    queryKey: ["tickets-stale-count", user?.id],
    queryFn: () => flask.get<{ count: number }>("/api/web/tickets/stale-count"),
    enabled: Boolean(user?.id),
    refetchInterval: STALE_POLL_MS,
  });
  const helpdeskBadge = useQuery({
    queryKey: ["helpdesk-nav-badge", user?.id],
    queryFn: async () => {
      try {
        return await flask.get<{ count: number }>("/helpdesk/api/nav-badge");
      } catch {
        return { count: 0 };
      }
    },
    enabled: Boolean(user?.id),
    refetchInterval: HELPDESK_POLL_MS,
    refetchOnWindowFocus: true,
    retry: 0,
  });
  const chatBadge = useQuery({
    queryKey: ["internal-chat-nav-badge", user?.id],
    queryFn: async () => {
      try {
        return await flask.get<{ count: number }>("/internal-chat/api/nav-badge");
      } catch {
        return { count: 0 };
      }
    },
    enabled: Boolean(user?.id),
    refetchInterval: HELPDESK_POLL_MS,
    refetchOnWindowFocus: true,
    retry: 0,
  });
  const staleCount = stale.data?.count ?? 0;
  const helpdeskCount = helpdeskBadge.data?.count ?? 0;
  const chatCount = chatBadge.data?.count ?? 0;

  const mobilePrimaryItems = [
    {
      href: "/helpdesk",
      label: "Help Desk",
      icon: Headset,
      badge: helpdeskCount,
      badgeLabel: `${helpdeskCount} mensagens novas no Help Desk`,
    },
    {
      href: "/chat",
      label: "Chat",
      icon: MessageCircle,
      badge: chatCount,
      badgeLabel: `${chatCount} mensagens novas no chat interno`,
    },
    {
      href: "/tickets",
      label: "Tickets",
      icon: Ticket,
      badge: staleCount,
      badgeLabel: `${staleCount} tickets abertos há mais de 7 dias`,
    },
  ];

  return (
    <>
      <aside
        className={cn(
          "hidden h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-line bg-sidebar text-ink transition-[width] duration-200 md:flex",
          collapsed ? "w-18" : "w-65",
        )}
      >
        <div
          className={cn(
            "flex items-center border-b border-line pb-3 pt-3",
            collapsed ? "justify-center px-2" : "px-4",
          )}
        >
          <Logo collapsed={collapsed} />
        </div>
        <nav className={cn("min-h-0 flex-1 space-y-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
          {items.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            const Icon = item.icon;
            const badge =
              item.href === "/tickets"
                ? staleCount
                : item.href === "/helpdesk"
                  ? helpdeskCount
                  : item.href === "/chat"
                    ? chatCount
                    : 0;
            const badgeLabel =
              item.href === "/tickets"
                ? `${badge} tickets abertos há mais de 7 dias`
                : item.href === "/helpdesk"
                  ? `${badge} mensagens novas no Help Desk`
                  : item.href === "/chat"
                    ? `${badge} mensagens novas no chat interno`
                    : "";
            const title = badge > 0 ? `${item.label} (${badgeLabel})` : item.label;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={title}
                className={cn(
                  "flex items-center rounded-xl py-2.5 text-[14px] transition-colors",
                  collapsed ? "justify-center px-0" : "gap-3 px-3",
                  active
                    ? "bg-progress-bg font-medium text-brand"
                    : "text-navy/70 hover:bg-sidebar-hover hover:text-navy",
                )}
              >
                {collapsed ? (
                  <span className="relative inline-flex">
                    <Icon className="h-4 w-4 shrink-0" />
                    <NavAlertBadge count={badge} collapsed label={badgeLabel} />
                    <span className="sr-only">{title}</span>
                  </span>
                ) : (
                  <>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <NavAlertBadge count={badge} label={badgeLabel} />
                  </>
                )}
              </Link>
            );
          })}
        </nav>
        <div className={cn("relative border-t border-line", collapsed ? "p-2" : "p-4")}>
          {menuOpen ? (
            <div
              className={cn(
                "absolute z-20 overflow-hidden rounded-xl border border-line bg-surface py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
                collapsed ? "fixed bottom-4 left-20 z-50 w-52" : "bottom-19 left-4 right-4",
              )}
            >
              <p className="px-4 pb-1 text-[10px] tracking-[0.14em] text-muted">OPÇÕES</p>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setProfileOpen(true);
                }}
                className="flex w-full items-center gap-2 bg-progress-bg px-4 py-2 text-left text-sm text-navy"
              >
                <UserRound className="h-4 w-4 text-brand" />
                Perfil
              </button>
              <ThemeToggle />
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-open hover:bg-open-bg"
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            title={user?.name || "Conta"}
            className={cn(
              "flex w-full items-center rounded-xl p-1 text-left transition-colors hover:bg-sidebar-hover",
              collapsed ? "justify-center" : "gap-3",
            )}
          >
            <UserAvatar name={user?.name} src={user?.avatar_url || undefined} size="sm" />
            {collapsed ? (
              <span className="sr-only">{user?.name}</span>
            ) : (
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-navy">{user?.name}</span>
                <span className="block truncate text-xs text-muted">{user?.email}</span>
              </span>
            )}
          </button>
        </div>
      </aside>

      {/* Menu Sidebar Drawer (Mobile) */}
      {mobileDrawerOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-label="Menu de navegação">
          <div
            className="fixed inset-0 bg-black/45 transition-opacity"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col overflow-hidden border-r border-line bg-sidebar text-ink shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <Logo collapsed={false} />
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-sidebar-hover hover:text-navy"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                Módulos do sistema
              </p>
              {mobileRestItems.map((item) => {
                const active = isNavItemActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileDrawerOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-colors",
                      active
                        ? "bg-progress-bg font-medium text-brand"
                        : "text-navy/70 hover:bg-sidebar-hover hover:text-navy",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-line p-3">
              <div className="mb-2 flex items-center gap-3 px-2 py-1">
                <UserAvatar name={user?.name} src={user?.avatar_url || undefined} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-navy">{user?.name}</span>
                  <span className="block truncate text-xs text-muted">{user?.email}</span>
                </span>
              </div>
              <div className="space-y-0.5 rounded-xl border border-line bg-surface py-1">
                <button
                  type="button"
                  onClick={() => {
                    setMobileDrawerOpen(false);
                    setProfileOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-navy hover:bg-sidebar-hover"
                >
                  <UserRound className="h-4 w-4 text-brand" />
                  Perfil
                </button>
                <ThemeToggle />
                <button
                  type="button"
                  onClick={() => {
                    setMobileDrawerOpen(false);
                    logout();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-open hover:bg-open-bg"
                >
                  <LogOut className="h-4 w-4" />
                  Sair
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {/* Barra Inferior Fixa com 4 Ícones Navegáveis (Mobile) */}
      <nav
        aria-label="Navegação principal móvel"
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-line bg-sidebar px-2 shadow-[0_-2px_10px_rgba(15,23,42,0.06)] md:hidden"
      >
        {mobilePrimaryItems.map((item) => {
          const active = !mobileDrawerOpen && isNavItemActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileDrawerOpen(false)}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition-colors",
                active ? "text-brand" : "text-navy/70 hover:text-navy",
              )}
            >
              <span className="relative inline-flex">
                <Icon className={cn("h-5 w-5", active && "stroke-[2.25]")} />
                <NavAlertBadge count={item.badge} collapsed label={item.badgeLabel} />
              </span>
              <span className="truncate">{item.label}</span>
              {active ? <span className="absolute bottom-0.5 h-1 w-6 rounded-full bg-brand" /> : null}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMobileDrawerOpen((v) => !v)}
          aria-expanded={mobileDrawerOpen}
          aria-label="Abrir menu com demais páginas"
          className={cn(
            "relative flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-[11px] font-medium transition-colors",
            mobileDrawerOpen || isRestRouteActive ? "text-brand" : "text-navy/70 hover:text-navy",
          )}
        >
          <span className="relative inline-flex">
            {mobileDrawerOpen ? <X className="h-5 w-5 stroke-[2.25]" /> : <Menu className="h-5 w-5" />}
          </span>
          <span className="truncate">Menu</span>
          {mobileDrawerOpen || isRestRouteActive ? (
            <span className="absolute bottom-0.5 h-1 w-6 rounded-full bg-brand" />
          ) : null}
        </button>
      </nav>

      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
