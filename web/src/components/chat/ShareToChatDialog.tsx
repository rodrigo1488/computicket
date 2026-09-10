"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton } from "@/components/ui/UnderlineField";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { SharedEntityCard } from "@/components/chat/SharedEntityCard";
import { chatDisplayName, internalChat, INTERNAL_CHAT_MAX_MEDIA_BYTES, type InternalChat } from "@/lib/internal-chat";
import { encodeChatShare, type ChatSharePayload } from "@/lib/chat-share";
import { cn } from "@/lib/cn";

export type ShareToChatTarget = {
  payload?: ChatSharePayload;
  text?: string;
  mediaUrl?: string | null;
  mediaName?: string | null;
};

async function fileFromUrl(url: string, name: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Não foi possível copiar a mídia da mensagem.");
  const blob = await res.blob();
  const fileName = name || url.split("/").pop()?.split("?")[0] || "midia";
  return new File([blob], fileName, { type: blob.type || "application/octet-stream" });
}

function shareMessage(target: ShareToChatTarget, note: string) {
  if (target.payload) return encodeChatShare(target.payload, note);
  const extra = note.trim();
  const body = (target.text || "").trim();
  if (body && extra) return `${body}\n\n${extra}`;
  return body || extra;
}

export function ShareToChatDialog({
  open,
  onClose,
  target,
  excludeChatId,
}: {
  open: boolean;
  onClose: () => void;
  target: ShareToChatTarget | null;
  excludeChatId?: number | null;
}) {
  const [query, setQuery] = useState("");
  const [chatId, setChatId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const chats = useQuery({
    queryKey: ["internal-chats-share"],
    queryFn: () => internalChat.chats({ pageNumber: "1" }),
    enabled: open,
  });

  const items = useMemo(() => {
    const records = (chats.data?.records || []).filter((chat) => chat.id !== excludeChatId);
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((chat) => chatDisplayName(chat).toLowerCase().includes(q));
  }, [chats.data?.records, query, excludeChatId]);

  const send = useMutation({
    mutationFn: async () => {
      if (!target || !chatId) throw new Error("Escolha uma conversa.");
      const message = shareMessage(target, note);
      const mediaUrl = target.mediaUrl?.trim();
      if (mediaUrl) {
        const file = await fileFromUrl(mediaUrl, target.mediaName || "midia");
        if (file.size > INTERNAL_CHAT_MAX_MEDIA_BYTES) {
          await internalChat.send(chatId, `${message}\n\n(Mídia não encaminhada: arquivo maior que 10 MB.)`);
          return;
        }
        await internalChat.sendMedia(chatId, file, message);
        return;
      }
      await internalChat.send(chatId, message);
    },
    onSuccess: () => {
      setNote("");
      setChatId(null);
      setQuery("");
      setError("");
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível encaminhar."),
  });

  return (
    <Modal open={open} onClose={onClose} title="Encaminhar no chat interno">
      <div className="space-y-4">
        {target?.payload ? (
          <SharedEntityCard payload={target.payload} compact />
        ) : target?.text || target?.mediaName ? (
          <p className="rounded-xl border border-line bg-wash px-3 py-2 text-sm text-ink">
            {(target.text || target.mediaName || "Mensagem").slice(0, 180)}
          </p>
        ) : null}
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Buscar conversa</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nome do colega ou grupo"
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line p-1">
          {chats.isLoading ? <p className="px-2 py-3 text-sm text-muted">Carregando conversas…</p> : null}
          {chats.isError ? (
            <p className="px-2 py-3 text-sm text-open">{(chats.error as Error).message}</p>
          ) : null}
          {!chats.isLoading && items.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">Nenhuma conversa encontrada</p>
          ) : null}
          {items.map((chat) => (
            <ChatPickRow key={chat.id} chat={chat} selected={chatId === chat.id} onSelect={() => setChatId(chat.id)} />
          ))}
        </div>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Comentário (opcional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Contexto para o colega"
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        {error ? <p className="text-sm text-open">{error}</p> : null}
        <PrimaryButton
          type="button"
          disabled={
            send.isPending ||
            !chatId ||
            !target ||
            (!target.payload && !target.text?.trim() && !target.mediaUrl)
          }
          onClick={() => send.mutate()}
        >
          {send.isPending ? "Enviando…" : "Encaminhar"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}

function ChatPickRow({
  chat,
  selected,
  onSelect,
}: {
  chat: InternalChat;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = chatDisplayName(chat);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-wash",
        selected && "bg-progress-bg",
      )}
    >
      <UserAvatar name={name} src={chat.isGroup ? null : chat.peer?.avatar} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{name}</span>
        <span className="block text-[11px] text-muted">{chat.isGroup ? "Grupo" : "Conversa"}</span>
      </span>
    </button>
  );
}
