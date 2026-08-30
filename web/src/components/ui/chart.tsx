"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/cn";

export type ChartConfig = Record<string, { label: string; color: string }>;

function ChartContainer({
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { children: React.ReactElement }) {
  return (
    <div
      data-slot="chart"
      className={cn(
        "flex aspect-auto h-[260px] w-full justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted [&_.recharts-cartesian-grid_line]:stroke-line [&_.recharts-curve.recharts-tooltip-cursor]:stroke-line [&_.recharts-layer]:outline-none [&_.recharts-surface]:outline-none",
        className,
      )}
      {...props}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

type TooltipPayload = {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  value?: string | number;
};

function ChartTooltipContent({
  active,
  payload,
  label,
  config,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  config: ChartConfig;
  labelFormatter?: (label: string | number) => React.ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-xl border border-line bg-white px-3 py-2.5 text-xs shadow-xl">
      <p className="mb-2 font-medium text-navy">{labelFormatter ? labelFormatter(label ?? "") : label}</p>
      <div className="grid gap-1.5">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? "");
          const entry = config[key];
          return (
            <div key={key} className="flex items-center justify-between gap-5">
              <span className="flex items-center gap-2 text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: item.color || entry?.color }} />
                {entry?.label || item.name}
              </span>
              <span className="font-mono font-medium tabular-nums text-ink">{item.value ?? "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltipContent };
