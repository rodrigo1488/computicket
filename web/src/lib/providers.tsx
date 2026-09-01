"use client";

import { AuthProvider } from "@/lib/auth-context";
import { QueryProvider } from "@/lib/query-provider";
import { ThemeProvider } from "@/lib/theme-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <ThemeProvider>
          <div className="flex h-full min-h-0 flex-col overflow-hidden">{children}</div>
        </ThemeProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
