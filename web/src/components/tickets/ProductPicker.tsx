"use client";

import { useState } from "react";
import { UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { formatBRL } from "@/lib/format";

export type ProductHit = { id: number; codigo?: string; nome: string; preco?: number };
export type PickedProduct = { id: number; nome: string; quantidade: number };

export function ProductPicker({
  searchPath,
  picked,
  onChange,
}: {
  searchPath: string;
  picked: PickedProduct[];
  onChange: (next: PickedProduct[]) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [error, setError] = useState("");

  const search = async () => {
    if (!q.trim()) return;
    setError("");
    try {
      const res = await flask.get<{ products?: ProductHit[]; error?: string }>(
        `${searchPath}?q=${encodeURIComponent(q.trim())}`,
      );
      setHits(res.products || []);
      if (!(res.products || []).length) setError("Nenhum produto encontrado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao buscar produtos");
    }
  };

  return (
    <div>
      <UnderlineField label="Produtos (opcional)" value={q} onChange={setQ} placeholder="Nome ou código" />
      <button type="button" onClick={() => void search()} className="mt-2 text-sm text-navy underline">
        Buscar produtos
      </button>
      {error ? <p className="mt-2 text-sm text-open">{error}</p> : null}
      {hits.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {hits.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="text-sm text-ink hover:underline"
                onClick={() => {
                  onChange(picked.some((x) => x.id === p.id) ? picked : [...picked, { id: p.id, nome: p.nome, quantidade: 1 }]);
                }}
              >
                + {p.nome} {p.preco != null ? `(${formatBRL(p.preco)})` : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {picked.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {picked.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
              <span>{p.nome}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={p.quantidade}
                  onChange={(e) =>
                    onChange(
                      picked.map((x) => (x.id === p.id ? { ...x, quantidade: Number(e.target.value) || 1 } : x)),
                    )
                  }
                  className="w-16 border-0 border-b border-[#d7d7d7] bg-transparent py-1 text-right"
                />
                <button
                  type="button"
                  className="text-xs text-open"
                  onClick={() => onChange(picked.filter((x) => x.id !== p.id))}
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
