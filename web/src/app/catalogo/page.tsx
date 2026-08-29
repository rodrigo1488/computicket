"use client";

import { useQuery } from "@tanstack/react-query";
import { flask } from "@/lib/api";

type Sys = { id: number; name: string; description: string; active_plans: number };

export default function CatalogoPage() {
  const { data } = useQuery({
    queryKey: ["catalog"],
    queryFn: () => flask.get<Sys[]>("/api/web/catalog"),
  });
  return (
    <div className="mx-auto h-full min-h-0 max-w-4xl overflow-y-auto bg-canvas p-8">
      <div className="rounded-[28px] bg-white p-10">
        <h1 className="mb-8 text-[28px] font-semibold text-navy">Catálogo de planos</h1>
        <div className="grid gap-4 md:grid-cols-2">
          {(data || []).map((s) => (
            <article key={s.id} className="rounded-2xl border border-[#eee] p-5">
              <h2 className="text-lg font-semibold">{s.name}</h2>
              <p className="mt-1 text-sm text-muted">{s.description || "—"}</p>
              <p className="mt-3 text-sm">{s.active_plans} planos</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
