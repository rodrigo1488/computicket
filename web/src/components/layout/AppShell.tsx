"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/cn";

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

  const isHelpdesk = pathname.startsWith("/helpdesk");

  return (
    <div className="flex h-full max-h-full min-h-0 overflow-hidden bg-canvas">
      <AppSidebar />
      <main
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          isHelpdesk ? "p-3" : "p-5",
        )}
      >
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1",
            isHelpdesk
              ? "flex h-0 min-h-0 flex-col overflow-hidden rounded-[28px] bg-white shadow-sm"
              : "overflow-y-auto rounded-[28px] bg-white p-8 shadow-sm",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

export function PageTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h1 className={cn("mb-8 text-[28px] font-semibold text-navy", className)}>{children}</h1>;
}
