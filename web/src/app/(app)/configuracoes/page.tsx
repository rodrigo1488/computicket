"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageTitle } from "@/components/layout/AppShell";
import { AiSettings } from "@/components/settings/AiSettings";
import { UniplusSettings } from "@/components/settings/UniplusSettings";
import { WhatsappSettings, type WhatsappSection } from "@/components/settings/WhatsappSettings";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { EditAction } from "@/components/ui/RowActions";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";

type Cfg = Record<string, { value: string; description?: string }>;
type ConfigTab = "geral" | "email" | "sistema" | "ia" | "whatsapp" | "uniplus";

const TABS: { key: ConfigTab; label: string }[] = [
  { key: "geral", label: "Geral" },
  { key: "email", label: "E-mail" },
  { key: "sistema", label: "Sistema" },
  { key: "ia", label: "IA" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "uniplus", label: "Uniplus" },
];

/** Rótulos amigáveis para chaves técnicas de SystemConfig. */
const CONFIG_LABELS: Record<string, string> = {
  auto_assign_tickets: "Atribuir tickets automaticamente",
  email_notifications: "Notificações por e-mail",
  ticket_prefix: "Prefixo dos tickets",
  backup_enabled: "Backup automático",
  backup_frequency: "Frequência do backup (dias)",
  system_name: "Nome do sistema",
  system_url: "URL do sistema",
  system_timezone: "Fuso horário",
  mail_server: "Servidor SMTP",
  mail_port: "Porta SMTP",
  mail_use_tls: "Usar TLS no SMTP",
  mail_username: "Usuário SMTP",
  mail_password: "Senha SMTP",
  mail_default_sender: "E-mail remetente padrão",
  os_products_required: "Exigir produtos na OS",
};

function configLabel(key: string, description?: string) {
  return CONFIG_LABELS[key] || description || key.replace(/_/g, " ");
}

function formatConfigValue(key: string, value?: string) {
  if (value == null || value === "") return "—";
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes" || lower === "on") return "Sim";
  if (lower === "false" || lower === "0" || lower === "no" || lower === "off") return "Não";
  if (key === "mail_password" && value) return "••••••••";
  return value;
}

function asTab(raw: string | null): ConfigTab {
  if (raw === "email" || raw === "sistema" || raw === "ia" || raw === "whatsapp" || raw === "uniplus" || raw === "geral")
    return raw;
  return "geral";
}

function asSection(raw: string | null): WhatsappSection {
  if (raw === "agentes" || raw === "conexoes" || raw === "filas" || raw === "rapidas") return raw;
  return "filas";
}

function ConfigPageInner() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const tab = asTab(params.get("tab"));
  const section = asSection(params.get("section"));
  const [page, setPage] = useState(1);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const perPage = 20;

  const isConfigTab = tab !== "ia" && tab !== "whatsapp" && tab !== "uniplus";

  const { data, error } = useQuery({
    queryKey: ["config"],
    queryFn: () => flask.get<{ email: Cfg; general: Cfg; system: Cfg }>("/api/web/config"),
    enabled: isConfigTab,
  });

  const rows = useMemo(() => {
    const source =
      tab === "email" ? data?.email : tab === "sistema" ? data?.system : data?.general;
    return Object.entries(source || {}).map(([k, v]) => ({ key: k, ...v }));
  }, [data, tab]);

  const slice = rows.slice((page - 1) * perPage, page * perPage);

  const save = useMutation({
    mutationFn: () => flask.post("/configuracoes/save", { [editKey || ""]: editValue }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      setEditKey(null);
    },
  });

  useEffect(() => setPage(1), [tab]);

  function go(nextTab: ConfigTab, nextSection?: WhatsappSection) {
    const q = new URLSearchParams();
    if (nextTab !== "geral") q.set("tab", nextTab);
    if (nextTab === "whatsapp") q.set("section", nextSection || section);
    router.replace(q.toString() ? `/configuracoes?${q}` : "/configuracoes");
  }

  return (
    <div>
      <PageTitle>Configurações</PageTitle>
      <div className="mb-8 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((item) => (
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
      ) : tab === "uniplus" ? (
        <UniplusSettings />
      ) : tab === "ia" ? (
        <AiSettings />
      ) : (
        <div>
          {error ? <p className="text-open">{(error as Error).message}</p> : null}
          <div className="space-y-2">
            {slice.map((row) => {
              const label = configLabel(row.key, row.description);
              const hint =
                row.description && row.description !== label ? row.description : null;
              return (
              <div key={row.key} className="flex items-center justify-between gap-3 rounded-xl border border-[#eee] px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink">{label}</p>
                  {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
                  <p className="mt-1 text-sm text-muted">{formatConfigValue(row.key, row.value)}</p>
                </div>
                <EditAction
                  onClick={() => {
                    setEditKey(row.key);
                    setEditValue(row.value || "");
                  }}
                />
              </div>
              );
            })}
            {rows.length === 0 ? <p className="text-sm text-muted">Sem configurações nesta aba</p> : null}
          </div>
          <Pagination page={page} perPage={perPage} total={rows.length} onPage={setPage} />
        </div>
      )}

      <Modal
        open={!!editKey}
        onClose={() => setEditKey(null)}
        title={`Editar ${editKey ? configLabel(editKey, rows.find((r) => r.key === editKey)?.description) : ""}`}
      >
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <UnderlineField
            label="Valor"
            value={editValue}
            onChange={setEditValue}
            type={editKey === "mail_password" ? "password" : "text"}
            hint={
              editKey && ["true", "false"].includes((rows.find((r) => r.key === editKey)?.value || "").toLowerCase())
                ? 'Use "true" ou "false"'
                : undefined
            }
          />
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
