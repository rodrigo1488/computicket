"use client";

import { Bot, ImagePlus, LoaderCircle, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { Link } from "@/components/tabs/navigation";
import { useEffect, useRef, useState } from "react";
import { helpdesk, type HelpdeskAiSource } from "@/lib/helpdesk";
import { cn } from "@/lib/cn";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  imageUrl?: string;
  sources?: HelpdeskAiSource[];
  error?: boolean;
};

type ChatAttachment = {
  dataUrl: string;
  name: string;
};

const SUGGESTIONS = [
  "O que está travando os atendimentos de hoje?",
  "Como explico ao cliente que a nota não saiu, sem prometer prazo?",
  "Agende uma visita para o cliente amanhã às 14h",
];

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      reject(new Error("Envie uma imagem PNG, JPEG ou WebP."));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error("A imagem passa de 4 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não consegui ler a imagem."));
    reader.readAsDataURL(file);
  });
}

function sourceHref(source: HelpdeskAiSource) {
  const explicit = source.href || source.url;
  if (
    explicit?.startsWith("/conhecimento") ||
    explicit?.startsWith("/tickets") ||
    explicit?.startsWith("/cofre") ||
    explicit?.startsWith("/orcamentos")
  ) {
    return explicit;
  }

  const ticketId =
    source.ticket_id ||
    source.metadata?.ticket_id ||
    (source.source_type === "ticket" ? source.source_id : undefined);
  if (ticketId) return `/tickets/${ticketId}`;

  if (source.source_type === "password_vault") {
    const clientId = source.client_id || source.metadata?.client_id;
    return clientId ? `/cofre/${clientId}` : "/cofre";
  }

  if (source.source_type === "budget" && source.source_id) {
    return `/orcamentos/${source.source_id}`;
  }

  const categoryId =
    source.category_id ||
    source.metadata?.category_id ||
    source.knowledge_id ||
    source.metadata?.knowledge_id;
  const articleId =
    source.article_id ||
    source.metadata?.article_id ||
    (source.source_type === "knowledge_article" ? source.source_id : undefined);
  if (categoryId && articleId) return `/conhecimento/${categoryId}?artigo=${articleId}`;
  if (categoryId) return `/conhecimento/${categoryId}`;
  if (source.source_type === "knowledge_article" && source.source_id) {
    return `/conhecimento`;
  }
  return null;
}

function Sources({ sources }: { sources: HelpdeskAiSource[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-2 border-t border-line/80 pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Fontes</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {sources.map((source, index) => {
          const href = sourceHref(source);
          const typeLabel =
            source.source_type === "ticket"
              ? `Chamado #${source.source_id}`
              : source.source_type === "password_vault"
                ? `Cofre #${source.source_id}`
                : source.source_type === "budget"
                  ? `Orçamento #${source.source_id}`
                  : source.source_type === "knowledge_article"
                    ? `Artigo: ${source.title || `#${source.source_id}`}`
                    : `Artigo #${source.source_id || index + 1}`;
          const label = source.title || source.name || typeLabel;
          const chip = (
            <span className="inline-flex max-w-full truncate rounded-md border border-[#dbe4f3] bg-surface px-2 py-0.5 text-[11px] text-navy">
              {label}
            </span>
          );
          return href ? (
            <Link key={`${href}-${index}`} href={href} className="hover:opacity-80">
              {chip}
            </Link>
          ) : (
            <span key={`src-${index}`}>{chip}</span>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardAiChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [heldPrint, setHeldPrint] = useState<ChatAttachment | null>(null);
  const [attachError, setAttachError] = useState("");
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending, open]);

  async function attachFile(file: File | undefined) {
    if (!file || pending) return;
    try {
      const dataUrl = await readImage(file);
      setAttachment({ dataUrl, name: file.name || "print" });
      setAttachError("");
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Não consegui ler a imagem.");
    }
  }

  async function send(questionRaw?: string) {
    const question = (questionRaw ?? input).trim();
    const freshImage = questionRaw ? undefined : attachment?.dataUrl;
    const image = freshImage || (questionRaw ? undefined : heldPrint?.dataUrl);
    if ((!question && !image) || pending) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: question || "Print enviado",
      imageUrl: freshImage,
    };
    const history = [...messages, userMsg]
      .filter((m) => !m.error)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (image) setHeldPrint({ dataUrl: image, name: attachment?.name || heldPrint?.name || "print" });
    setAttachment(null);
    setAttachError("");
    setPending(true);

    try {
      const result = await helpdesk.aiChat(
        question,
        history.slice(0, -1).length ? history.slice(0, -1) : undefined,
        image,
      );
      if (result.saved_article) setHeldPrint(null);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: result.draft?.trim() || "Sem resposta disponível.",
          sources: result.sources || [],
        },
      ]);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Não foi possível consultar o assistente. Verifique a configuração de IA.";
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: message,
          error: true,
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  function clearChat() {
    if (pending) return;
    setMessages([]);
    setInput("");
    setAttachment(null);
    setHeldPrint(null);
    setAttachError("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-inverse px-4 py-3 text-sm font-semibold text-on-inverse shadow-lg transition hover:opacity-90",
          open && "pointer-events-none opacity-0",
        )}
        aria-label="Abrir assistente de IA"
      >
        <Sparkles className="h-4 w-4 text-brand" />
        Assistente
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/25" onClick={() => setOpen(false)}>
          <aside
            className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Assistente IA Computicket"
          >
            <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-navy">
                  <Bot className="h-4 w-4 text-brand" />
                  Assistente IA
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Agenda visita, consulta a operação e guarda problema com solução no conhecimento.
                </p>
              </div>
              <div className="flex items-center gap-1">
                {messages.length ? (
                  <button
                    type="button"
                    onClick={clearChat}
                    className="rounded-md px-2 py-1 text-xs text-muted hover:bg-canvas hover:text-ink"
                    disabled={pending}
                  >
                    Limpar
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink"
                  aria-label="Fechar assistente"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-wash px-4 py-4">
              {!messages.length && !pending ? (
                <div className="flex h-full flex-col items-center justify-center px-2 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface shadow-sm">
                    <MessageCircle className="h-6 w-6 text-brand" />
                  </div>
                  <p className="text-sm font-semibold text-navy">Como posso ajudar?</p>
                  <p className="mt-1 max-w-xs text-xs text-muted">
                    Pode pedir uma visita, colar um print do erro ou mandar o problema junto com a solução.
                  </p>
                  <div className="mt-4 flex w-full flex-col gap-2">
                    {SUGGESTIONS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => void send(item)}
                        className="rounded-xl border border-line bg-surface px-3 py-2 text-left text-xs text-ink shadow-sm hover:border-brand/40"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
                          msg.role === "user"
                            ? "bg-inverse text-on-inverse"
                            : msg.error
                              ? "border border-open/30 bg-open-bg text-open"
                              : "border border-[#e5ebf5] bg-surface text-ink",
                        )}
                      >
                        {msg.imageUrl ? (
                          <img
                            src={msg.imageUrl}
                            alt="Print enviado"
                            className="mb-2 max-h-40 rounded-lg border border-white/20"
                          />
                        ) : null}
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        {msg.role === "assistant" && msg.sources?.length ? (
                          <Sources sources={msg.sources} />
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {pending ? (
                    <div className="flex justify-start">
                      <div className="inline-flex items-center gap-2 rounded-2xl border border-[#e5ebf5] bg-surface px-3.5 py-2.5 text-xs text-muted shadow-sm">
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-brand" />
                        Pensando…
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <footer className="border-t border-line bg-surface p-3">
              {heldPrint && !attachment ? (
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-line bg-canvas px-2 py-1.5">
                  <img src={heldPrint.dataUrl} alt="" className="h-8 w-8 rounded-md object-cover" />
                  <p className="min-w-0 flex-1 truncate text-[11px] text-muted">
                    Este print entra no artigo quando a solução for salva.
                  </p>
                  <button
                    type="button"
                    onClick={() => setHeldPrint(null)}
                    className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink"
                    aria-label="Não anexar este print"
                    disabled={pending}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
              {attachment ? (
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-line bg-canvas p-2">
                  <img src={attachment.dataUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
                  <p className="min-w-0 flex-1 truncate text-xs text-ink">{attachment.name}</p>
                  <button
                    type="button"
                    onClick={() => setAttachment(null)}
                    className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink"
                    aria-label="Remover print"
                    disabled={pending}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void attachFile(file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={pending}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-muted hover:text-ink disabled:opacity-40"
                  aria-label="Anexar print"
                >
                  <ImagePlus className="h-4 w-4" />
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={(e) => {
                    const file = Array.from(e.clipboardData.files).find((item) =>
                      item.type.startsWith("image/"),
                    );
                    if (!file) return;
                    e.preventDefault();
                    void attachFile(file);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  disabled={pending}
                  placeholder="Mensagem, print ou erro com a solução…"
                  className="max-h-28 flex-1 resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={pending || (!input.trim() && !attachment)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white disabled:opacity-40"
                  aria-label="Enviar pergunta"
                >
                  {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </form>
              {attachError ? <p className="mt-2 text-[10px] text-open">{attachError}</p> : null}
              <p className="mt-2 text-[10px] text-muted">
                Cole um print do erro. A solução só entra no conhecimento quando você também contar como resolveu.
              </p>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}
