"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton } from "@/components/ui/UnderlineField";
import { encodeChatShare, chatShareKindLabel, type ChatShareKind, type ChatSharePayload } from "@/lib/chat-share";
import { flask, type PageRes } from "@/lib/api";
import { helpdesk, type HelpdeskConversation } from "@/lib/helpdesk";
import { type TicketCard } from "@/lib/format";
import { internalChat, type InternalChatMessage } from "@/lib/internal-chat";
import { cn } from "@/lib/cn";

type Tab = ChatShareKind;

type KnowledgeArt = {
  id: number;
  title: string;
  summary?: string;
  category?: string;
  category_id?: number;
};

type VaultClient = {
  id: number;
  name: string;
  is_external: boolean;
  passwords_count?: number;
};

type VaultItem = {
  id: number;
  machine_name: string;
};

const TABS: { id: Tab; label: string }[] = [
  { id: "ticket", label: "Ticket" },
  { id: "knowledge", label: "Conhecimento" },
  { id: "vault", label: "Cofre" },
  { id: "helpdesk", label: "Help Desk" },
];

export function AttachEntityToChatDialog({
  open,
  onClose,
  chatId,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  chatId: number | null;
  onSent?: (msg: InternalChatMessage) => void;
}) {
  const [tab, setTab] = useState<Tab>("ticket");
  const [q, setQ] = useState("");
  const [hdStatus, setHdStatus] = useState<"open" | "pending" | "closed">("open");
  const [vaultClient, setVaultClient] = useState<VaultClient | null>(null);
  const [picked, setPicked] = useState<ChatSharePayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setQ("");
    setPicked(null);
    setVaultClient(null);
    setError("");
  }, [open, tab]);

  const tickets = useQuery({
    queryKey: ["chat-attach-tickets", q],
    queryFn: () =>
      flask.get<PageRes<TicketCard>>(
        `/tickets/api/list?status=all&q=${encodeURIComponent(q)}&page=1&per_page=20`,
      ),
    enabled: open && tab === "ticket",
  });

  const articles = useQuery({
    queryKey: ["chat-attach-knowledge", q],
    queryFn: () =>
      flask.get<{ articles: KnowledgeArt[] }>(
        `/api/web/knowledge?kind=articles&q=${encodeURIComponent(q)}&page=1&per_page=20`,
      ),
    enabled: open && tab === "knowledge",
  });

  const vaultClients = useQuery({
    queryKey: ["chat-attach-vault", q],
    queryFn: () =>
      flask.get<PageRes<VaultClient>>(
        `/api/web/vault?q=${encodeURIComponent(q)}&page=1&per_page=20&with_passwords=true`,
      ),
    enabled: open && tab === "vault" && !vaultClient,
  });

  const vaultItems = useQuery({
    queryKey: ["chat-attach-vault-items", vaultClient?.id, vaultClient?.is_external],
    queryFn: () =>
      flask.get<PageRes<VaultItem>>(
        `/api/web/vault/clients/${vaultClient!.id}?page=1&per_page=30${vaultClient!.is_external ? "&external=1" : ""}`,
      ),
    enabled: open && tab === "vault" && !!vaultClient,
  });

  const helpdeskList = useQuery({
    queryKey: ["chat-attach-helpdesk", hdStatus, q],
    queryFn: () => helpdesk.conversations(hdStatus, "1", q),
    enabled: open && tab === "helpdesk",
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!chatId) throw new Error("Selecione uma conversa.");
      if (!picked) throw new Error("Escolha um item para encaminhar.");
      return internalChat.send(chatId, encodeChatShare(picked));
    },
    onSuccess: (msg) => {
      onSent?.(msg);
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível encaminhar."),
  });

  const rows = (() => {
    if (tab === "ticket") {
      return (tickets.data?.items || []).map((t) => ({
        key: `t-${t.id}`,
        title: `#${t.id} ${t.title}`,
        subtitle: t.client_name || t.status,
        payload: {
          kind: "ticket" as const,
          id: t.id,
          title: `#${t.id} ${t.title}`,
          subtitle: t.client_name || undefined,
          status: t.status,
          url: `/tickets/${t.id}`,
        },
      }));
    }
    if (tab === "knowledge") {
      return (articles.data?.articles || []).map((a) => ({
        key: `k-${a.id}`,
        title: a.title,
        subtitle: a.category || a.summary,
        payload: {
          kind: "knowledge" as const,
          id: a.id,
          title: a.title,
          subtitle: a.category,
          url: `/conhecimento/${a.category_id || ""}?artigo=${a.id}`,
        },
      }));
    }
    if (tab === "vault" && vaultClient) {
      return (vaultItems.data?.items || []).map((item) => ({
        key: `v-${item.id}`,
        title: item.machine_name,
        subtitle: vaultClient.name,
        payload: {
          kind: "vault" as const,
          id: item.id,
          title: item.machine_name,
          subtitle: vaultClient.name,
          url: `/cofre/${vaultClient.id}${vaultClient.is_external ? "?external=1" : ""}`,
        },
      }));
    }
    if (tab === "vault") {
      return (vaultClients.data?.items || []).map((c) => ({
        key: `vc-${c.id}`,
        title: c.name,
        subtitle: c.passwords_count ? `${c.passwords_count} senha(s)` : "Cofre",
        payload: null as ChatSharePayload | null,
        client: c,
      }));
    }
    return (helpdeskList.data?.tickets || []).map((c: HelpdeskConversation) => {
      const name = c.contact?.name || c.contact?.number || "Contato";
      return {
        key: `h-${c.id}`,
        title: name,
        subtitle: (c.lastMessage || "").replace(/\s+/g, " ").trim().slice(0, 80),
        payload: {
          kind: "helpdesk" as const,
          id: c.id,
          title: name,
          subtitle: (c.lastMessage || "").replace(/\s+/g, " ").trim().slice(0, 80) || undefined,
          url: `/helpdesk?c=${c.id}`,
        },
      };
    });
  })();

  const loading =
    (tab === "ticket" && tickets.isLoading) ||
    (tab === "knowledge" && articles.isLoading) ||
    (tab === "vault" && !vaultClient && vaultClients.isLoading) ||
    (tab === "vault" && !!vaultClient && vaultItems.isLoading) ||
    (tab === "helpdesk" && helpdeskList.isLoading);

  const fetchError =
    (tickets.error as Error | undefined)?.message ||
    (articles.error as Error | undefined)?.message ||
    (vaultClients.error as Error | undefined)?.message ||
    (vaultItems.error as Error | undefined)?.message ||
    (helpdeskList.error as Error | undefined)?.message;

  return (
    <Modal open={open} onClose={onClose} title="Encaminhar no chat" wide>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Escolha um ticket, artigo, senha do cofre ou conversa do help desk para enviar nesta conversa.
        </p>
        <div className="flex flex-wrap gap-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold",
                tab === item.id ? "bg-brand text-white" : "bg-wash text-ink hover:bg-line/60",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === "helpdesk" ? (
          <div className="flex gap-1">
            {(["open", "pending", "closed"] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setHdStatus(status)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[11px] font-medium",
                  hdStatus === status ? "bg-progress-bg text-navy" : "text-muted hover:bg-wash",
                )}
              >
                {status === "open" ? "Abertas" : status === "pending" ? "Pendentes" : "Fechadas"}
              </button>
            ))}
          </div>
        ) : null}
        {tab === "vault" && vaultClient ? (
          <button type="button" onClick={() => setVaultClient(null)} className="text-xs font-medium text-brand">
            ← {vaultClient.name}
          </button>
        ) : (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              tab === "ticket"
                ? "Buscar ticket"
                : tab === "knowledge"
                  ? "Buscar artigo"
                  : tab === "vault"
                    ? "Buscar cliente"
                    : "Buscar contato"
            }
            className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
        )}
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line p-1">
          {loading ? <p className="px-2 py-3 text-sm text-muted">Carregando…</p> : null}
          {fetchError ? <p className="px-2 py-3 text-sm text-open">{fetchError}</p> : null}
          {!loading && rows.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">Nenhum item encontrado</p>
          ) : null}
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => {
                if (tab === "vault" && !vaultClient && "client" in row && row.client) {
                  setVaultClient(row.client);
                  setPicked(null);
                  return;
                }
                if (row.payload) setPicked(row.payload);
              }}
              className={cn(
                "flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-wash",
                picked && row.payload && picked.kind === row.payload.kind && String(picked.id) === String(row.payload.id)
                  ? "bg-progress-bg"
                  : "",
              )}
            >
              <span className="truncate text-sm font-medium text-ink">{row.title}</span>
              {row.subtitle ? <span className="truncate text-[11px] text-muted">{row.subtitle}</span> : null}
            </button>
          ))}
        </div>
        {picked ? (
          <p className="text-xs text-muted">
            {chatShareKindLabel(picked.kind)}: {picked.title}
          </p>
        ) : null}
        {error ? <p className="text-sm text-open">{error}</p> : null}
        <PrimaryButton type="button" disabled={send.isPending || !picked || !chatId} onClick={() => send.mutate()}>
          {send.isPending ? "Enviando…" : "Enviar nesta conversa"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}
