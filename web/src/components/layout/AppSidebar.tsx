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

const SIDEBAR_KEY = "computicket.sidebar";
const STALE_POLL_MS = 90_000;
const HELPDESK_POLL_MS = 45_000;

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
        "flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-sidebar text-white transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-[260px]",
      )}
    >
      <div
        className={cn(
          "flex items-center pb-3 pt-3",
          collapsed ? "flex-col gap-2 px-2" : "justify-between gap-2 px-4",
        )}
      >
        {!collapsed && <Logo collapsed={collapsed} />}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          aria-expanded={!collapsed}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/55 hover:bg-white/10 hover:text-white"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
        {collapsed && <Logo collapsed={collapsed} />}
      </div>
      <nav className={cn("no-scrollbar flex-1 space-y-1 overflow-y-auto pb-4", collapsed ? "px-2" : "px-3")}>
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
                "flex items-center rounded-xl py-2.5 text-[14px] transition",
                collapsed ? "justify-center px-0" : "gap-3 px-3",
                active ? "bg-brand text-white" : "text-white/70 hover:bg-sidebar-hover hover:text-white",
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
      <div className={cn("relative border-t border-white/10", collapsed ? "p-2" : "p-4")}>
        {menuOpen ? (
          <div
            className={cn(
              "absolute z-20 overflow-hidden rounded-xl bg-[#111] py-2 shadow-xl",
              collapsed ? "fixed bottom-4 left-[80px] z-50 w-52" : "bottom-[76px] left-4 right-4",
            )}
          >
            <p className="px-4 pb-1 text-[10px] tracking-[0.14em] text-white/40">OPÇÕES</p>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setProfileOpen(true);
              }}
              className="flex w-full items-center gap-2 bg-white/10 px-4 py-2 text-left text-sm text-white"
            >
              <UserRound className="h-4 w-4" />
              Perfil
            </button>
            <button
              type="button"
              onClick={logout}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-400 hover:bg-white/10"
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
            "flex w-full items-center rounded-xl p-1 text-left hover:bg-white/5",
            collapsed ? "justify-center" : "gap-3",
          )}
        >
          <UserAvatar name={user?.name} src={user?.avatar_url || undefined} size="sm" />
          {collapsed ? (
            <span className="sr-only">{user?.name}</span>
          ) : (
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user?.name}</span>
              <span className="block truncate text-xs text-white/50">{user?.email}</span>
            </span>
          )}
        </button>
      </div>
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </aside>
  );
}
