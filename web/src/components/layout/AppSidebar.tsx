"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LogOut, PanelLeftClose, PanelLeftOpen, UserRound } from "lucide-react";
import { useState } from "react";
import { flask } from "@/lib/api";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { ProfileDialog } from "@/components/profile/ProfileDialog";
import { Logo } from "@/components/layout/Logo";
import { ThemeQuickToggle, ThemeToggle } from "@/components/layout/ThemeToggle";

const SIDEBAR_KEY = "computicket.sidebar";
const STALE_POLL_MS = 90_000;
const HELPDESK_POLL_MS = 15_000;

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
        "inline-flex min-w-[18px] items-center justify-center rounded-full bg-open px-1.5 text-[10px] font-bold leading-[18px] text-white",
        collapsed && "absolute -right-1.5 -top-1.5 min-w-[16px] px-1 leading-[16px]",
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

export function AppSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const role = (user?.role || "").toLowerCase();
  const isAdmin = ["admin", "administrador", "administrator"].includes(role);
  const isTech = isAdmin || role === "tecnico";

  const items = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.techOnly && !isTech) return false;
    return true;
  });

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
  const staleCount = stale.data?.count ?? 0;
  const helpdeskCount = helpdeskBadge.data?.count ?? 0;

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "expanded");
      return next;
    });
    setMenuOpen(false);
  }

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-line bg-sidebar text-ink transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-[260px]",
      )}
    >
      <div
        className={cn(
          "flex items-center border-b border-line pb-3 pt-3",
          collapsed ? "flex-col gap-2 px-2" : "justify-between gap-2 px-4",
        )}
      >
        {!collapsed && <Logo collapsed={collapsed} />}
        <div className={cn("flex shrink-0 items-center", collapsed ? "flex-col gap-1" : "gap-1")}>
          <ThemeQuickToggle />
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-expanded={!collapsed}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sidebar-hover hover:text-navy"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        {collapsed && <Logo collapsed={collapsed} />}
      </div>
      <nav className={cn("no-scrollbar flex-1 space-y-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          const badge =
            item.href === "/tickets" ? staleCount : item.href === "/helpdesk" ? helpdeskCount : 0;
          const badgeLabel =
            item.href === "/tickets"
              ? `${badge} tickets abertos há mais de 7 dias`
              : item.href === "/helpdesk"
                ? `${badge} mensagens novas no Help Desk`
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
              collapsed ? "fixed bottom-4 left-[80px] z-50 w-52" : "bottom-[76px] left-4 right-4",
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
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </aside>
  );
}
