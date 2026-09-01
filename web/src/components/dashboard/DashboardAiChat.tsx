"use client";

import { Bot, LoaderCircle, MessageCircle, Send, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { helpdesk, type HelpdeskAiSource } from "@/lib/helpdesk";
import { cn } from "@/lib/cn";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  sources?: HelpdeskAiSource[];
  error?: boolean;
};

const SUGGESTIONS = [
  "Qual a senha/AnyDesk da máquina do cliente X? (abrir no cofre)",
  "Há orçamento aberto para o cliente Y?",
  "Resuma o ticket mais recente sobre impressora",
];

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
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  async function send(questionRaw?: string) {
    const question = (questionRaw ?? input).trim();
    if (!question || pending) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: question,
    };
    const history = [...messages, userMsg]
      .filter((m) => !m.error)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setPending(true);

    try {
      const result = await helpdesk.aiChat(
        question,
        history.slice(0, -1).length ? history.slice(0, -1) : undefined,
      );
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
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-inverse px-4 py-3 text-sm font-semibold text-on-inverse shadow-lg transition hover:bg-[#1c2f52]",
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
                  Respostas com base na base de conhecimento e tickets fechados.
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

            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-[#f7f8fb] px-4 py-4">
              {!messages.length && !pending ? (
                <div className="flex h-full flex-col items-center justify-center px-2 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface shadow-sm">
                    <MessageCircle className="h-6 w-6 text-brand" />
                  </div>
                  <p className="text-sm font-semibold text-navy">Como posso ajudar?</p>
                  <p className="mt-1 max-w-xs text-xs text-muted">
                    Pergunte sobre procedimentos, clientes, SLA ou artigos do conhecimento.
                  </p>
                  <div className="mt-4 flex w-full flex-col gap-2">
                    {SUGGESTIONS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => void send(item)}
                        className="rounded-xl border border-[#e2e8f0] bg-surface px-3 py-2 text-left text-xs text-ink shadow-sm hover:border-brand/40"
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
                        Consultando a base de conhecimento…
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <footer className="border-t border-line bg-surface p-3">
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  disabled={pending}
                  placeholder="Pergunte sobre procedimentos, clientes…"
                  className="max-h-28 flex-1 resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={pending || !input.trim()}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white disabled:opacity-40"
                  aria-label="Enviar pergunta"
                >
                  {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </form>
              <p className="mt-2 text-[10px] text-muted">
                Conteúdo gerado por IA com RAG. Revise antes de usar com clientes.
              </p>
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}
