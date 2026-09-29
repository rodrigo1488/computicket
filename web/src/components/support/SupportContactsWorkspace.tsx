"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { WhatsAppFormattedText } from "@/components/helpdesk/WhatsAppFormattedText";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";
import { helpdesk, unwrapConnections } from "@/lib/helpdesk";

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

const emptyContact = { name: "", number: "", supportWhatsappId: "" };

export function SupportContactsWorkspace() {
  const qc = useQueryClient();
  const [folderId, setFolderId] = useState<number | null>(null);
  const [folderModal, setFolderModal] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [contactModal, setContactModal] = useState(false);
  const [contactForm, setContactForm] = useState(emptyContact);
  const [editingContact, setEditingContact] = useState<SupportContact | null>(null);
  const [active, setActive] = useState<{ contact: SupportContact; ticketId: number } | null>(null);
  const [draft, setDraft] = useState("");
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

  const connections = useQuery({
    queryKey: ["hd-connections"],
    queryFn: () => helpdesk.connections(),
  });
  const connectionOptions = useMemo(() => unwrapConnections(connections.data), [connections.data]);

  const messages = useQuery({
    queryKey: ["support-messages", active?.ticketId],
    enabled: !!active?.ticketId,
    refetchInterval: active?.ticketId ? 4000 : false,
    queryFn: () =>
      flask.get<{ messages: ChatMessage[] }>(
        `/helpdesk/api/support/conversations/${active!.ticketId}/messages?pageNumber=1`,
      ),
  });

  const saveFolder = useMutation({
    mutationFn: async () => {
      const name = folderName.trim();
      if (!name) throw new Error("Nome da pasta é obrigatório");
      if (editingFolder) {
        return flask.put(`/helpdesk/api/support/folders/${editingFolder.id}`, { name });
      }
      return flask.post<Folder>("/helpdesk/api/support/folders", { name });
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["support-folders"] });
      if (!editingFolder && created && typeof created === "object" && "id" in created) {
        setFolderId(Number((created as Folder).id));
      }
      setFolderModal(false);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível salvar a pasta"),
  });

  const removeFolder = useMutation({
    mutationFn: (id: number) => flask.delete(`/helpdesk/api/support/folders/${id}`),
    onSuccess: () => {
      setFolderId(null);
      qc.invalidateQueries({ queryKey: ["support-folders"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível excluir a pasta"),
  });

  const saveContact = useMutation({
    mutationFn: async () => {
      if (!folderId) throw new Error("Escolha uma pasta de sistema");
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
      if (active?.contact.id === id) setActive(null);
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
      setSavedUrl("");
      setActive({ contact, ticketId: data.ticket.id });
      setError("");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível abrir a conversa"),
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("Abra uma conversa");
      const body = draft.trim();
      if (!body) throw new Error("Digite a mensagem");
      return flask.post(`/helpdesk/api/support/conversations/${active.ticketId}/messages`, { body });
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["support-messages", active?.ticketId] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível enviar"),
  });

  const previewKnowledge = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("Abra uma conversa");
      return flask.post<KnowledgeDraft>(
        `/helpdesk/api/support/conversations/${active.ticketId}/knowledge/preview`,
        {},
      );
    },
    onSuccess: (data) => {
      setKnowledge({
        title: data.title || "",
        problem: data.problem || "",
        solution: data.solution || "",
        has_solution: data.has_solution,
        system_name: data.system_name || active?.contact.folder?.name || "",
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
      if (!active || !knowledge) throw new Error("Nada para gravar");
      return flask.post<{ url: string; title: string }>(
        `/helpdesk/api/support/conversations/${active.ticketId}/knowledge`,
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

  const selectedFolder = folderList.find((folder) => folder.id === folderId) || null;

  return (
    <div className="flex h-0 min-h-0 min-w-0 flex-1 overflow-hidden">
      <aside className="flex w-[320px] min-w-0 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">Contatos de suporte</p>
            <p className="text-xs text-muted">Fora do Help Desk</p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-brand hover:bg-progress-bg"
            title="Nova pasta"
            aria-label="Nova pasta de sistema"
            onClick={() => {
              setEditingFolder(null);
              setFolderName("");
              setError("");
              setFolderModal(true);
            }}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-line px-3 py-2">
          {folders.isLoading ? <p className="px-1 py-2 text-sm text-muted">Carregando pastas…</p> : null}
          {folderList.length === 0 && !folders.isLoading ? (
            <p className="px-1 py-3 text-sm text-muted">Crie uma pasta para cada sistema.</p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {folderList.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setFolderId(folder.id);
                      setActive(null);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm",
                      folder.id === folderId ? "bg-progress-bg text-brand" : "text-ink hover:bg-canvas",
                    )}
                  >
                    <span className="truncate">{folder.name}</span>
                    <span className="text-xs text-muted">{folder.contactsCount ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selectedFolder ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="text-xs text-muted hover:text-ink"
                onClick={() => {
                  setEditingFolder(selectedFolder);
                  setFolderName(selectedFolder.name);
                  setFolderModal(true);
                }}
              >
                Renomear pasta
              </button>
              <button
                type="button"
                className="text-xs text-muted hover:text-ink"
                onClick={() => {
                  if (window.confirm(`Excluir a pasta ${selectedFolder.name}?`)) {
                    removeFolder.mutate(selectedFolder.id);
                  }
                }}
              >
                Excluir pasta
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Contatos</span>
          <button
            type="button"
            disabled={!folderId}
            className="rounded-md p-1 text-brand hover:bg-progress-bg disabled:opacity-40"
            title="Novo contato"
            aria-label="Adicionar contato de suporte"
            onClick={() => {
              setEditingContact(null);
              setContactForm(emptyContact);
              setError("");
              setContactModal(true);
            }}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {(contacts.data?.contacts || []).map((contact) => (
            <div
              key={contact.id}
              className={cn(
                "mb-1 rounded-xl px-3 py-2",
                active?.contact.id === contact.id ? "bg-progress-bg" : "hover:bg-canvas",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => openChat.mutate(contact)}
                >
                  <p className="truncate text-sm font-medium text-ink">{contact.name}</p>
                  <p className="truncate text-xs text-muted">{contact.number}</p>
                  <p className="truncate text-xs text-muted">
                    {contact.connection?.name || "Padrão"}
                  </p>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="rounded p-1 text-muted hover:text-ink"
                    aria-label={`Editar ${contact.name}`}
                    onClick={() => {
                      setEditingContact(contact);
                      setContactForm({
                        name: contact.name,
                        number: contact.number,
                        supportWhatsappId: contact.supportWhatsappId
                          ? String(contact.supportWhatsappId)
                          : "",
                      });
                      setContactModal(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-muted hover:text-ink"
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
              </div>
              <button
                type="button"
                className="mt-1 text-xs font-medium text-brand"
                onClick={() => openChat.mutate(contact)}
              >
                {openChat.isPending ? "Abrindo…" : "Conversar"}
              </button>
            </div>
          ))}
          {folderId && !contacts.isLoading && (contacts.data?.contacts || []).length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted">Nenhum contato nesta pasta.</p>
          ) : null}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error ? (
          <p className="border-b border-line px-4 py-2 text-sm text-rose-600" role="alert">
            {error}
          </p>
        ) : null}
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted">
            <LifeBuoy className="h-8 w-8" />
            <p className="max-w-sm text-sm">
              Escolha um contato de suporte para abrir a conversa direta. Ela não vira atendimento no Help Desk.
            </p>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{active.contact.name}</p>
                <p className="truncate text-xs text-muted">
                  {active.contact.number} · {active.contact.connection?.name || "Conexão padrão"} · fora do Help Desk
                </p>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas disabled:opacity-50"
                disabled={previewKnowledge.isPending}
                onClick={() => previewKnowledge.mutate()}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {previewKnowledge.isPending ? "Lendo conversa…" : "Registrar solução"}
              </button>
            </header>
            {savedUrl ? (
              <p className="border-b border-line px-4 py-2 text-sm text-ink">
                Solução gravada no conhecimento.{" "}
                <Link href={savedUrl} className="text-brand underline">
                  Abrir artigo
                </Link>
              </p>
            ) : null}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {(messages.data?.messages || []).map((message) => (
                <div
                  key={message.id}
                  className={cn("flex", message.fromMe ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
                      message.fromMe ? "bg-brand text-white" : "bg-canvas text-ink",
                    )}
                  >
                    <WhatsAppFormattedText text={message.body || message.mediaType || ""} />
                  </div>
                </div>
              ))}
              {messages.isLoading ? <p className="text-sm text-muted">Carregando mensagens…</p> : null}
            </div>
            <form
              className="flex gap-2 border-t border-line p-3"
              onSubmit={(event) => {
                event.preventDefault();
                send.mutate();
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Mensagem para o suporte"
                className="min-w-0 flex-1 rounded-xl border border-line bg-transparent px-3 py-2 text-sm text-ink"
              />
              <PrimaryButton type="submit" disabled={send.isPending}>
                Enviar
              </PrimaryButton>
            </form>
          </>
        )}
      </section>

      <Modal
        open={folderModal}
        title={editingFolder ? "Renomear pasta" : "Nova pasta de sistema"}
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
