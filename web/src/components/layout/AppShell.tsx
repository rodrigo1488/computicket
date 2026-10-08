"use client";

import { useContext, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { TabBar } from "@/components/tabs/TabBar";
import { TabHost } from "@/components/tabs/TabHost";
import { TabsProvider } from "@/components/tabs/TabsProvider";
import { TabsViewContext } from "@/components/tabs/context";
import { isChatLayoutPath } from "@/components/tabs/routes";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/cn";

function ShellFrame({ children }: { children: React.ReactNode }) {
  const view = useContext(TabsViewContext);
  const activePathname = view?.tabs.find((t) => t.id === view.activeId)?.pathname ?? "/";
  const isChatLayout = isChatLayoutPath(activePathname);

  return (
    <div id="app-shell" className="flex h-full max-h-full min-h-0 overflow-hidden bg-canvas">
      <AppSidebar />
      <main
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          isChatLayout ? "p-3" : "p-5",
        )}
      >
        <TabBar />
        {/* Cada aba tem o seu próprio contêiner rolável dentro deste (ver TabHost). */}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[28px] bg-surface shadow-sm">
          <TabHost>{children}</TabHost>
        </div>
      </main>
      <NotificationCenter />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);

  if (loading || !user) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas text-muted">Carregando…</div>
    );
  }

  return (
    <TabsProvider userKey={String(user.id)}>
      <ShellFrame>{children}</ShellFrame>
    </TabsProvider>
  );
}

export function PageTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h1 className={cn("mb-8 text-[28px] font-semibold text-navy", className)}>{children}</h1>;
}
