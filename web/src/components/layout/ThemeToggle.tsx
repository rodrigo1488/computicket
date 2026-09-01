"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme, type Theme } from "@/lib/theme-context";

export function ThemeQuickToggle({ className }: { className?: string }) {
  const { resolved, setTheme } = useTheme();
  const dark = resolved === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      title={dark ? "Tema claro" : "Tema escuro"}
      aria-label={dark ? "Ativar tema claro" : "Ativar tema escuro"}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sidebar-hover hover:text-navy",
        className,
      )}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="px-3 py-2">
      <p className="px-1 pb-1.5 text-[10px] tracking-[0.14em] text-muted">TEMA</p>
      <div className="grid grid-cols-3 gap-0.5 rounded-lg bg-wash p-0.5">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            title={label}
            aria-pressed={theme === value}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors",
              theme === value ? "bg-surface text-navy shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
