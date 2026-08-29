import type { ColFilter } from "@/lib/api";

export function applyColFilters<T>(items: T[], filters: ColFilter[]): T[] {
  const active = filters.filter((f) => f.value.trim());
  if (!active.length) return items;
  return items.filter((item) =>
    active.every((f) => {
      const hay = String((item as Record<string, unknown>)[f.field] ?? "").toLocaleLowerCase("pt-BR");
      const n = f.value.toLocaleLowerCase("pt-BR").trim();
      if (f.op === "equals") return hay === n;
      return hay.includes(n);
    }),
  );
}

export function applyTextSearch<T>(items: T[], q: string, texts: (item: T) => (string | number | null | undefined)[]): T[] {
  const n = q.trim().toLocaleLowerCase("pt-BR");
  if (!n) return items;
  return items.filter((item) =>
    texts(item).some((t) => String(t ?? "").toLocaleLowerCase("pt-BR").includes(n)),
  );
}
