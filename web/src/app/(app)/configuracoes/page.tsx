"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageTitle } from "@/components/layout/AppShell";
import { WhatsappSettings, type WhatsappSection } from "@/components/settings/WhatsappSettings";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EditAction } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";

type Cfg = Record<string, { value: string; description?: string }>;
type MainTab = "sistema" | "whatsapp";

function asSection(raw: string | null): WhatsappSection {
  if (raw === "agentes" || raw === "conexoes" || raw === "filas" || raw === "rapidas") return raw;
  return "filas";
}

function ConfigPageInner() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const tab: MainTab = params.get("tab") === "whatsapp" ? "whatsapp" : "sistema";
  const section = asSection(params.get("section"));
  const [page, setPage] = useState(1);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const perPage = 20;

  const { data, error } = useQuery({
    queryKey: ["config"],
    queryFn: () => flask.get<{ email: Cfg; general: Cfg; system: Cfg }>("/api/web/config"),
    enabled: tab === "sistema",
  });

  const rows = [
    ...Object.entries(data?.email || {}).map(([k, v]) => ({ key: k, ...v, category: "E-mail" })),
    ...Object.entries(data?.general || {}).map(([k, v]) => ({ key: k, ...v, category: "Geral" })),
    ...Object.entries(data?.system || {}).map(([k, v]) => ({ key: k, ...v, category: "Sistema" })),
  ];
  const slice = rows.slice((page - 1) * perPage, page * perPage);

  const save = useMutation({
    mutationFn: () => flask.post("/config/save", { [editKey || ""]: editValue }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      setEditKey(null);
    },
  });

  useEffect(() => setPage(1), [tab]);

  function go(nextTab: MainTab, nextSection?: WhatsappSection) {
    const q = new URLSearchParams();
    if (nextTab === "whatsapp") {
      q.set("tab", "whatsapp");
      q.set("section", nextSection || section);
    }
    router.replace(q.toString() ? `/configuracoes?${q}` : "/configuracoes");
  }

  return (
    <div>
      <PageTitle>Configurações</PageTitle>
      <div className="mb-8 flex gap-1 border-b border-line">
        {(
          [
            { key: "sistema", label: "Sistema" },
            { key: "whatsapp", label: "WhatsApp" },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => go(item.key)}
            className={cn(
              "relative px-5 py-2.5 text-sm font-semibold",
              tab === item.key ? "text-brand" : "text-muted hover:text-ink",
            )}
          >
            {item.label}
            {tab === item.key ? <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-brand" /> : null}
          </button>
        ))}
      </div>

      {tab === "whatsapp" ? (
        <WhatsappSettings section={section} onSection={(s) => go("whatsapp", s)} />
      ) : (
        <div>
          {error ? <p className="text-open">{(error as Error).message}</p> : null}
          <div className="space-y-2">
            {slice.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3 rounded-xl border border-[#eee] px-4 py-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">
                    {row.category} · {row.key}
                  </p>
                  <p className="mt-1 text-sm">{row.value || "—"}</p>
                </div>
                <EditAction
                  onClick={() => {
                    setEditKey(row.key);
                    setEditValue(row.value || "");
                  }}
                />
              </div>
            ))}
            {rows.length === 0 ? <p className="text-sm text-muted">Sem configurações</p> : null}
          </div>
          <Pagination page={page} perPage={perPage} total={rows.length} onPage={setPage} />
        </div>
      )}

      <Modal open={!!editKey} onClose={() => setEditKey(null)} title={`Editar ${editKey || ""}`}>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <UnderlineField label="Valor" value={editValue} onChange={setEditValue} />
          <PrimaryButton type="submit" disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </PrimaryButton>
        </form>
      </Modal>
    </div>
  );
}

export default function ConfigPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Carregando configurações…</p>}>
      <ConfigPageInner />
    </Suspense>
  );
}
