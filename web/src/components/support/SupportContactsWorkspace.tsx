"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, LoaderCircle, Pencil, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { WhatsAppFormattedText } from "@/components/helpdesk/WhatsAppFormattedText";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";
import { helpdesk, unwrapConnections } from "@/lib/helpdesk";
import { sortMessagesChronologically } from "@/lib/helpdeskMessages";

type Folder = { id: number; name: string; contactsCount?: number };
type ConnectionChoice = { id: number | null; name: string };
type SupportContact = {
  id: number;
  name: string;
  number: string;
  supportFolderId: number | null;
  supportWhatsappId: number | null;
  folder?: { id: number; name: string } | null;
  connection?: ConnectionChoice;
  conversation?: { id: number; lastMessage?: string; unreadMessages?: number } | null;
};
type ChatMessage = {
  id: string;
  body?: string;
  fromMe?: boolean;
  createdAt?: string;
  mediaType?: string;
};
type KnowledgeDraft = {
  title: string;
  problem: string;
  solution: string;
  has_solution?: boolean;
  system_name?: string;
};
type OpenChat = { contactId: number; ticketId: number; contact: SupportContact };
type SubTab = "contacts" | number;

const emptyContact = { name: "", number: "", supportWhatsappId: "" };

function formatClock(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function SupportContactsWorkspace() {
  const qc = useQueryClient();
  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [folderModal, setFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [contactModal, setContactModal] = useState(false);
  const [contactForm, setContactForm] = useState(emptyContact);
  const [editingContact, setEditingContact] = useState<SupportContact | null>(null);
  const [openBySystem, setOpenBySystem] = useState<Record<number, OpenChat[]>>({});
  const [tabBySystem, setTabBySystem] = useState<Record<number, SubTab>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [knowledge, setKnowledge] = useState<KnowledgeDraft | null>(null);
  const [savedUrl, setSavedUrl] = useState("");

  const folders = useQuery({
    queryKey: ["support-folders"],
    queryFn: () => flask.get<{ folders: Folder[] }>("/helpdesk/api/support/folders"),
  });
  const folderList = folders.data?.folders || [];

  useEffect(() => {
    if (folderId == null && folderList[0]) setFolderId(folderList[0].id);
  }, [folderId, folderList]);

  const contacts = useQuery({
    queryKey: ["support-contacts", folderId],
    enabled: folderId != null,
    queryFn: () =>
      flask.get<{ contacts: SupportContact[] }>(
        `/helpdesk/api/support/contacts?folderId=${folderId}`,
      ),
  });
  const contactList = contacts.data?.contacts || [];

  const connections = useQuery({
    queryKey: ["hd-connections"],
    queryFn: () => helpdesk.connections(),
  });
  const connectionOptions = useMemo(() => unwrapConnections(connections.data), [connections.data]);

  const selectedFolder = folderList.find((folder) => folder.id === folderId) || null;
  const openChats = folderId != null ? openBySystem[folderId] || [] : [];
  const visibleChats = openChats
    .map((chat) => {
      const fresh = contactList.find((item) => item.id === chat.contactId);
      return fresh ? { ...chat, contact: fresh } : chat;
    })
    .filter((chat) => !contacts.isSuccess || contactList.some((item) => item.id === chat.contactId));
  const requestedTab: SubTab = folderId != null ? (tabBySystem[folderId] ?? "contacts") : "contacts";
  const activeChat =
    requestedTab === "contacts"
      ? null
      : visibleChats.find((chat) => chat.contactId === requestedTab) || null;
  const activeTicketId = activeChat?.ticketId ?? null;
  const draft = activeTicketId != null ? drafts[activeTicketId] || "" : "";

  const messages = useQuery({
    queryKey: ["support-messages", activeTicketId],
    enabled: activeTicketId != null,
    refetchInterval: activeTicketId ? 4000 : false,
    queryFn: () =>
      flask.get<{ messages: ChatMessage[] }>(
        `/helpdesk/api/support/conversations/${activeTicketId}/messages?pageNumber=1`,
      ),
  });
  const thread = useMemo(
    () => sortMessagesChronologically(messages.data?.messages || []),
    [messages.data?.messages],
  );

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [activeTicketId]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [thread, activeTicketId]);

  const saveFolder = useMutation({
    mutationFn: async () => {
      const name = folderName.trim();
      if (!name) throw new Error("Nome do sistema é obrigatório");
      if (editingFolder) {
        return flask.put(`/helpdesk/api/support/folders/${editingFolder.id}`, { name });
      }
      return flask.post<Folder>("/helpdesk/api/support/folders", { name });
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["support-folders"] });
      if (!editingFolder && created && typeof created === "object" && "id" in created) {
        const id = Number((created as Folder).id);
        setFolderId(id);
        setTabBySystem((prev) => ({ ...prev, [id]: "contacts" }));
      }
      setFolderModal(false);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível salvar o sistema"),
  });

  const removeFolder = useMutation({
    mutationFn: (id: number) => flask.delete(`/helpdesk/api/support/folders/${id}`),
    onSuccess: (_data, id) => {
      setOpenBySystem((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setTabBySystem((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setFolderId(null);
      qc.invalidateQueries({ queryKey: ["support-folders"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível excluir o sistema"),
  });

  const saveContact = useMutation({
    mutationFn: async () => {
      if (!folderId) throw new Error("Escolha um sistema");
      const payload = {
        name: contactForm.name.trim(),
        number: contactForm.number.trim(),
        folderId,
        supportWhatsappId: contactForm.supportWhatsappId
          ? Number(contactForm.supportWhatsappId)
          : null,
      };
      if (!payload.name) throw new Error("Nome é obrigatório");
      if (editingContact) {
        return flask.put(`/helpdesk/api/support/contacts/${editingContact.id}`, payload);
      }
      return flask.post("/helpdesk/api/support/contacts", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["support-contacts"] });
      qc.invalidateQueries({ queryKey: ["support-folders"] });
      setContactModal(false);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível salvar o contato"),
  });

  const removeContact = useMutation({
    mutationFn: (id: number) => flask.delete(`/helpdesk/api/support/contacts/${id}`),
    onSuccess: (_data, id) => {
      setOpenBySystem((prev) => {
        const next: Record<number, OpenChat[]> = {};
        for (const [key, list] of Object.entries(prev)) {
          next[Number(key)] = list.filter((item) => item.contactId !== id);
        }
        return next;
      });
      setTabBySystem((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (next[Number(key)] === id) next[Number(key)] = "contacts";
        }
        return next;
      });
      qc.invalidateQueries({ queryKey: ["support-contacts"] });
      qc.invalidateQueries({ queryKey: ["support-folders"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível remover o contato"),
  });

  const openChat = useMutation({
    mutationFn: (contact: SupportContact) =>
      flask.post<{ ticket: { id: number } }>(
        `/helpdesk/api/support/contacts/${contact.id}/conversation`,
        {},
      ),
    onSuccess: (data, contact) => {
      const systemId = contact.supportFolderId ?? folderId;
      if (systemId == null) return;
      setSavedUrl("");
      setOpenBySystem((prev) => {
        const list = prev[systemId] || [];
        const entry: OpenChat = { contactId: contact.id, ticketId: data.ticket.id, contact };
        const next = list.some((item) => item.contactId === contact.id)
          ? list.map((item) => (item.contactId === contact.id ? entry : item))
          : [...list, entry];
        return { ...prev, [systemId]: next };
      });
      setTabBySystem((prev) => ({ ...prev, [systemId]: contact.id }));
      setError("");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível abrir a conversa"),
  });

  const send = useMutation({
    mutationFn: async (ticketId: number) => {
      const body = (drafts[ticketId] || "").trim();
      if (!body) throw new Error("Digite a mensagem");
      return flask.post(`/helpdesk/api/support/conversations/${ticketId}/messages`, { body });
    },
    onSuccess: (_data, ticketId) => {
      setDrafts((prev) => ({ ...prev, [ticketId]: "" }));
      qc.invalidateQueries({ queryKey: ["support-messages", ticketId] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível enviar"),
  });

  const previewKnowledge = useMutation({
    mutationFn: async () => {
      if (!activeChat) throw new Error("Abra uma conversa");
      return flask.post<KnowledgeDraft>(
        `/helpdesk/api/support/conversations/${activeChat.ticketId}/knowledge/preview`,
        {},
      );
    },
    onSuccess: (data) => {
      setKnowledge({
        title: data.title || "",
        problem: data.problem || "",
        solution: data.solution || "",
        has_solution: data.has_solution,
        system_name: data.system_name || activeChat?.contact.folder?.name || selectedFolder?.name || "",
      });
      setError("");
    },
    onError: (e) =>
      setError(
        e instanceof Error
          ? e.message
          : "A IA não está disponível para interpretar esta conversa",
      ),
  });

  const saveKnowledge = useMutation({
    mutationFn: async () => {
      if (!activeChat || !knowledge) throw new Error("Nada para gravar");
      return flask.post<{ url: string; title: string }>(
        `/helpdesk/api/support/conversations/${activeChat.ticketId}/knowledge`,
        knowledge,
      );
    },
    onSuccess: (data) => {
      setSavedUrl(data.url || "");
      setKnowledge(null);
      setError("");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível gravar o artigo"),
  });

  function selectSystem(id: number) {
    setFolderId(id);
    setError("");
    setSavedUrl("");
  }

  function selectTab(tab: SubTab) {
    if (folderId == null) return;
    setTabBySystem((prev) => ({ ...prev, [folderId]: tab }));
    setError("");
  }

  function closeChat(systemId: number, contactId: number) {
    setOpenBySystem((prev) => ({
      ...prev,
      [systemId]: (prev[systemId] || []).filter((item) => item.contactId !== contactId),
    }));
    setTabBySystem((prev) => (prev[systemId] === contactId ? { ...prev, [systemId]: "contacts" } : prev));
  }

  function startConversation(contact: SupportContact) {
    if (folderId == null) return;
    const existing = (openBySystem[folderId] || []).find((item) => item.contactId === contact.id);
    if (existing) {
      setTabBySystem((prev) => ({ ...prev, [folderId]: contact.id }));
      setError("");
      return;
    }
    openChat.mutate(contact);
  }

  function openContactModal(contact?: SupportContact) {
    setEditingContact(contact || null);
    setContactForm(
      contact
        ? {
            name: contact.name,
            number: contact.number,
            supportWhatsappId: contact.supportWhatsappId ? String(contact.supportWhatsappId) : "",
          }
        : emptyContact,
    );
    setError("");
    setContactModal(true);
  }

  const openingId = openChat.isPending ? openChat.variables?.id : null;

  return (
    <div className="flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Contatos de suporte</p>
            <p className="text-xs text-muted">Fora do Help Desk</p>
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand hover:bg-progress-bg"
            onClick={() => {
              setEditingFolder(null);
              setFolderName("");
              setError("");
              setFolderModal(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Criar sistema
          </button>
        </div>
        <div className="flex items-end gap-2 px-2">
          <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto" role="tablist" aria-label="Sistemas">
            {folders.isLoading ? <p className="px-2 py-2 text-sm text-muted">Carregando sistemas…</p> : null}
            {folderList.map((folder) => {
              const selected = folder.id === folderId;
              return (
                <button
                  key={folder.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectSystem(folder.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm",
                    selected
                      ? "border-brand font-semibold text-brand"
                      : "border-transparent text-muted hover:text-ink",
                  )}
                >
                  <span className="max-w-48 truncate">{folder.name}</span>
                  <span className={cn("text-xs", selected ? "text-brand/80" : "text-muted")}>
                    {folder.contactsCount ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedFolder ? (
            <div className="mb-1.5 flex shrink-0 items-center gap-1 pr-2">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-muted hover:bg-wash hover:text-ink"
                onClick={() => {
                  setEditingFolder(selectedFolder);
                  setFolderName(selectedFolder.name);
                  setError("");
                  setFolderModal(true);
                }}
              >
                Renomear
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-muted hover:bg-open-bg hover:text-open"
                onClick={() => {
                  if (window.confirm(`Excluir o sistema ${selectedFolder.name}?`)) {
                    removeFolder.mutate(selectedFolder.id);
                  }
                }}
              >
                Excluir
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {!selectedFolder && !folders.isLoading ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-muted">
          <LifeBuoy className="h-8 w-8" />
          <p className="max-w-sm text-sm">Crie um sistema para agrupar os contatos de suporte dele.</p>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => {
              setEditingFolder(null);
              setFolderName("");
              setFolderModal(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Criar sistema
          </button>
        </div>
      ) : selectedFolder ? (
        <>
          <div
            className="flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-line bg-wash px-2"
            role="tablist"
            aria-label={`Sub-abas de ${selectedFolder.name}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={!activeChat}
              onClick={() => selectTab("contacts")}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2 text-sm",
                !activeChat ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              Contatos
            </button>
            {visibleChats.map((chat) => {
              const selected = activeChat?.contactId === chat.contactId;
              return (
                <div
                  key={chat.contactId}
                  className={cn(
                    "inline-flex shrink-0 items-center border-b-2",
                    selected ? "border-brand" : "border-transparent",
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => selectTab(chat.contactId)}
                    className={cn(
                      "max-w-48 truncate px-3 py-2 text-sm",
                      selected ? "font-medium text-ink" : "text-muted hover:text-ink",
                    )}
                  >
                    {chat.contact.name}
                  </button>
                  <button
                    type="button"
                    className="mr-1 rounded p-1 text-muted hover:bg-surface hover:text-ink"
                    aria-label={`Fechar conversa com ${chat.contact.name}`}
                    title="Fechar conversa"
                    onClick={() => closeChat(selectedFolder.id, chat.contactId)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {error ? (
            <p className="shrink-0 border-b border-line bg-open-bg px-4 py-2 text-sm text-open" role="alert">
              {error}
            </p>
          ) : null}

          {!activeChat ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-4 py-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-ink">Contatos de {selectedFolder.name}</h2>
                  <p className="text-xs text-muted">Agrupados neste sistema, fora do Help Desk</p>
                </div>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                  onClick={() => openContactModal()}
                >
                  <Plus className="h-4 w-4" />
                  Adicionar contato
                </button>
              </div>
              {contacts.isLoading ? <p className="text-sm text-muted">Carregando contatos…</p> : null}
              {!contacts.isLoading && contactList.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-muted">
                  Nenhum contato neste sistema.
                </p>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {contactList.map((contact) => (
                    <li key={contact.id} className="rounded-xl border border-line bg-surface p-3 shadow-sm">
                      <p className="truncate text-sm font-semibold text-ink">{contact.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted">{contact.number}</p>
                      <p className="truncate text-xs text-muted">{contact.connection?.name || "Conexão padrão"}</p>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                          disabled={openingId === contact.id}
                          onClick={() => startConversation(contact)}
                        >
                          {openingId === contact.id ? "Abrindo…" : "Conversar"}
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-muted hover:bg-wash hover:text-ink"
                          aria-label={`Editar ${contact.name}`}
                          onClick={() => openContactModal(contact)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-muted hover:bg-open-bg hover:text-open"
                          aria-label={`Remover ${contact.name}`}
                          onClick={() => {
                            if (window.confirm(`Remover ${contact.name} dos contatos de suporte?`)) {
                              removeContact.mutate(contact.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <section className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden bg-chat">
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-chat-border bg-surface px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{activeChat.contact.name}</p>
                  <p className="truncate text-xs text-muted">
                    {activeChat.contact.number} · {activeChat.contact.connection?.name || "Conexão padrão"} · fora do
                    Help Desk
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash disabled:opacity-50"
                  disabled={previewKnowledge.isPending}
                  onClick={() => previewKnowledge.mutate()}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {previewKnowledge.isPending ? "Lendo conversa…" : "Registrar solução"}
                </button>
              </header>
              {savedUrl ? (
                <p className="shrink-0 border-b border-chat-border bg-surface px-4 py-2 text-sm text-ink">
                  Solução gravada no conhecimento.{" "}
                  <Link href={savedUrl} className="text-brand underline">
                    Abrir artigo
                  </Link>
                </p>
              ) : null}
              <div
                ref={threadRef}
                className="min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none]"
                onScroll={(event) => {
                  const el = event.currentTarget;
                  stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                }}
              >
                {messages.isLoading ? <p className="text-sm text-muted">Carregando mensagens…</p> : null}
                {messages.isSuccess && thread.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted">Nenhuma mensagem nesta conversa</p>
                ) : null}
                {thread.map((message) => (
                  <div
                    key={message.id}
                    className={cn("mb-2 flex", message.fromMe ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm",
                        message.fromMe
                          ? "rounded-tr-none bg-bubble-out text-ink"
                          : "rounded-tl-none bg-bubble-in text-ink",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">
                        <WhatsAppFormattedText text={message.body || message.mediaType || ""} />
                      </p>
                      {message.createdAt ? (
                        <p className="mt-0.5 text-right text-[10px] text-muted">{formatClock(message.createdAt)}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <form
                className="relative shrink-0 border-t border-chat-border bg-chat-composer px-3 py-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!activeTicketId || !draft.trim() || send.isPending) return;
                  send.mutate(activeTicketId);
                }}
              >
                <div className="flex items-center gap-2">
                  <input
                    value={draft}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (activeTicketId == null) return;
                      setDrafts((prev) => ({ ...prev, [activeTicketId]: value }));
                    }}
                    placeholder="Digite a mensagem"
                    autoComplete="off"
                    className="min-h-9 min-w-0 flex-1 rounded-lg border-0 bg-surface px-3 py-2 text-sm text-ink shadow-sm outline-none placeholder:text-muted"
                  />
                  <button
                    type="submit"
                    disabled={send.isPending || !draft.trim()}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 text-sm font-medium text-white disabled:opacity-40"
                    aria-label="Enviar"
                  >
                    {send.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Enviar
                  </button>
                </div>
              </form>
            </section>
          )}
        </>
      ) : null}

      <Modal
        open={folderModal}
        title={editingFolder ? "Renomear sistema" : "Novo sistema"}
        onClose={() => setFolderModal(false)}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveFolder.mutate();
          }}
        >
          <UnderlineField label="Sistema" value={folderName} onChange={setFolderName} placeholder="Ex.: Uniplus" />
          <PrimaryButton type="submit" disabled={saveFolder.isPending}>
            Salvar
          </PrimaryButton>
        </form>
      </Modal>

      <Modal
        open={contactModal}
        title={editingContact ? "Editar contato" : "Contato de suporte"}
        onClose={() => setContactModal(false)}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveContact.mutate();
          }}
        >
          <UnderlineField
            label="Nome"
            value={contactForm.name}
            onChange={(name) => setContactForm((current) => ({ ...current, name }))}
          />
          <UnderlineField
            label="Telefone / WhatsApp"
            value={contactForm.number}
            onChange={(number) => setContactForm((current) => ({ ...current, number }))}
            placeholder="11999999999"
          />
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Conexão</span>
            <select
              value={contactForm.supportWhatsappId}
              onChange={(event) =>
                setContactForm((current) => ({ ...current, supportWhatsappId: event.target.value }))
              }
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] text-ink"
            >
              <option value="">Padrão</option>
              {connectionOptions.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                  {connection.isDefault ? " (padrão)" : ""}
                </option>
              ))}
            </select>
          </label>
          <PrimaryButton type="submit" disabled={saveContact.isPending}>
            Salvar
          </PrimaryButton>
        </form>
      </Modal>

      <Modal open={!!knowledge} title="Registrar no conhecimento" onClose={() => setKnowledge(null)} wide>
        {knowledge ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveKnowledge.mutate();
            }}
          >
            {knowledge.has_solution === false ? (
              <p className="text-sm text-muted">
                A IA não encontrou uma solução clara nesta conversa. Complete os campos se quiser gravar mesmo assim.
              </p>
            ) : (
              <p className="text-sm text-muted">
                Revise a solução interpretada antes de gravar
                {knowledge.system_name ? ` em ${knowledge.system_name}` : ""}.
              </p>
            )}
            <UnderlineField
              label="Título"
              value={knowledge.title}
              onChange={(title) => setKnowledge({ ...knowledge, title })}
            />
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Problema</span>
              <textarea
                value={knowledge.problem}
                onChange={(event) => setKnowledge({ ...knowledge, problem: event.target.value })}
                className="mt-1 min-h-20 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Solução</span>
              <textarea
                value={knowledge.solution}
                onChange={(event) => setKnowledge({ ...knowledge, solution: event.target.value })}
                className="mt-1 min-h-28 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink"
              />
            </label>
            <PrimaryButton type="submit" disabled={saveKnowledge.isPending}>
              Gravar no conhecimento
            </PrimaryButton>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
