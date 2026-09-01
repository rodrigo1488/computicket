"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { applyTheme, useTheme, type Theme } from "@/lib/theme-context";

function useDarkClass() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(document.documentElement.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function ThemeQuickToggle({ className }: { className?: string }) {
  const { setTheme } = useTheme();
  const dark = useDarkClass();
  return (
    <button
      type="button"
      data-theme-toggle
      onClick={() => {
        queueMicrotask(() => {
          const next = document.documentElement.classList.contains("dark") ? "dark" : "light";
          setTheme(next);
        });
      }}
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
            onClick={() => {
              applyTheme(value);
              setTheme(value);
            }}
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
