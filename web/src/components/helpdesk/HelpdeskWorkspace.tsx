"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  FilePlus2,
  Hand,
  History,
  LoaderCircle,
  Lock,
  MessageSquarePlus,
  MoreVertical,
  Paperclip,
  PenLine,
  RotateCcw,
  Search,
  Send,
  Settings,
  Smile,
  Star,
  Ticket,
  Undo2,
  UserPlus,
  UserRound,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { CloseTicketDialog } from "@/components/tickets/CloseTicketDialog";
import { TicketCreateDialog } from "@/components/tickets/TicketCreateDialog";
import { TimeEntryDialog } from "@/components/tickets/TimeEntryDialog";
import { FloatingMenu } from "@/components/ui/FloatingMenu";
import { Modal } from "@/components/ui/Modal";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import type { TicketDetail } from "@/lib/format";
import {
  helpdesk,
  helpdeskMediaSizeError,
  publicMediaUrl,
  engineSocketOptions,
  isEngineSocketSameOrigin,
  resolveEngineSocketUrl,
  unwrapConnections,
  unwrapMessages,
  unwrapQuickMessages,
  type ConversationListRes,
  type EngineSession,
  type HelpdeskAiSource,
  type HelpdeskAiTicketDraft,
  type HelpdeskContact,
  type HelpdeskContactClientLink,
  type HelpdeskConversation,
  type HelpdeskConversationHistoryItem,
  type HelpdeskMessage,
  type HelpdeskQueue,
  type HelpdeskTab,
  type QuickMessage,
  type TransferPayload,
} from "@/lib/helpdesk";

const TAB_META: { key: HelpdeskTab; label: string }[] = [
  { key: "pending", label: "Aguardando" },
  { key: "open", label: "Abertas" },
  { key: "closed", label: "Finalizadas" },
];

const FILTER_KEY = "computicket.helpdesk.filters";
const SIGN_KEY = "computicket.helpdesk.sign";
const LIST_WIDTH_KEY = "computicket.helpdesk.listWidth";
const LIST_WIDTH_DEFAULT = 340;
const LIST_WIDTH_MIN = 260;
const LIST_WIDTH_MAX = 560;

function clampListWidth(width: number, parentWidth?: number) {
  const room = parentWidth != null ? Math.max(LIST_WIDTH_MIN, parentWidth - 380) : LIST_WIDTH_MAX;
  return Math.round(Math.min(LIST_WIDTH_MAX, room, Math.max(LIST_WIDTH_MIN, width)));
}

function readListWidth() {
  if (typeof window === "undefined") return LIST_WIDTH_DEFAULT;
  const n = Number(window.localStorage.getItem(LIST_WIDTH_KEY));
  if (!Number.isFinite(n)) return LIST_WIDTH_DEFAULT;
  return clampListWidth(n);
}

type AiResult =
  | { kind: "text"; title: string; draft: string; sources: HelpdeskAiSource[] }
  | { kind: "ticket"; title: string; ticket: HelpdeskAiTicketDraft; sources: HelpdeskAiSource[] };

function formatClock(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR");
}

function contactName(c?: HelpdeskConversation | null) {
  return c?.contact?.name || c?.contact?.number || "Contato";
}

function ticketDefaultsFromConversation(
  conversation?: HelpdeskConversation | null,
  link?: HelpdeskContactClientLink | null,
  base?: Partial<HelpdeskAiTicketDraft> | null,
): HelpdeskAiTicketDraft {
  const solicitante = (base?.solicitante || contactName(conversation)).trim();
  const linkedName = link?.external_client_name?.trim() || "";
  return {
    title: base?.title || `WhatsApp ${contactName(conversation)}`,
    description: base?.description ?? (snippet(conversation?.lastMessage) || ""),
    solicitante,
    clientQuery: linkedName || base?.clientQuery || solicitante,
    external_client_id: link?.external_client_id ?? base?.external_client_id ?? null,
    external_client_name: linkedName || base?.external_client_name || null,
  };
}

function snippet(text?: string | null) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().slice(0, 90);
}

function withAgentSignature(body: string, name?: string | null, enabled?: boolean, isInternal?: boolean) {
  const text = body.trim();
  const agent = name?.trim();
  if (!enabled || !agent || isInternal || !text) return text;
  return `*${agent.toUpperCase()}*\n${text}`;
}

function statusChip(c: HelpdeskConversation) {
  if (c.status === "pending" || (c.unreadMessages || 0) > 0) {
    return { label: "Aguardando resposta", className: "bg-open-bg text-warn-fg" };
  }
  if (c.status === "closed") return { label: "Finalizada", className: "bg-wash text-muted" };
  return { label: "Em atendimento", className: "bg-progress-bg text-progress" };
}

function asTab(raw: string | null): HelpdeskTab {
  if (raw === "open" || raw === "pending" || raw === "closed") return raw;
  return "pending";
}

function isTempMessageId(id?: string | null) {
  return !!id && String(id).startsWith("temp-");
}

function sameInternalFlags(a: HelpdeskMessage, b: HelpdeskMessage) {
  return !!(a.isInternal || a.isPrivate) === !!(b.isInternal || b.isPrivate);
}

function normalizeMessageBody(value?: string | null) {
  return (value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function isMediaMessage(m: HelpdeskMessage) {
  if (m.mediaUrl) return true;
  const t = (m.mediaType || "").toLowerCase();
  if (!t || t === "conversation" || t === "chat") return false;
  return /^(image|audio|video|application|document|sticker|ptt)/.test(t);
}

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif"]);
const AUDIO_EXT = new Set(["mp3", "ogg", "oga", "opus", "wav", "m4a", "aac", "weba", "caf", "flac", "amr"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "3gp", "3gpp", "mkv", "avi"]);

function mediaExt(url?: string | null) {
  const path = (url || "").split(/[?#]/)[0];
  const base = path.split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function mediaKind(mediaType?: string | null, mediaUrl?: string | null): "image" | "audio" | "video" | "file" {
  const raw = (mediaType || "").toLowerCase().split(";")[0].trim();
  const type = raw.replace(/message$/, "");
  const ext = mediaExt(mediaUrl);
  if (type === "ptt" || type.startsWith("ptt/") || type.startsWith("audio") || AUDIO_EXT.has(ext)) return "audio";
  if (type.startsWith("video") || VIDEO_EXT.has(ext)) return "video";
  if (type === "sticker" || type.startsWith("image") || IMAGE_EXT.has(ext)) return "image";
  return "file";
}

function isInlinePlayableMedia(mediaType?: string | null, mediaUrl?: string | null) {
  return mediaKind(mediaType, mediaUrl) !== "file";
}

function ThreadMedia({
  mediaUrl,
  mediaType,
  onReady,
}: {
  mediaUrl: string;
  mediaType?: string | null;
  onReady?: () => void;
}) {
  const src = publicMediaUrl(mediaUrl) || mediaUrl;
  const kind = mediaKind(mediaType, src);
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className="mb-1 block max-h-56 max-w-full rounded-md object-contain"
        onLoad={onReady}
      />
    );
  }
  if (kind === "audio") {
    return (
      <audio
        controls
        preload="metadata"
        src={src}
        aria-label="Áudio"
        className="mb-1 block h-11 w-full"
        onLoadedMetadata={onReady}
      />
    );
  }
  if (kind === "video") {
    return (
      <video
        controls
        playsInline
        preload="metadata"
        src={src}
        aria-label="Vídeo"
        className="mb-1 block max-h-64 w-full max-w-[280px] rounded-md bg-black"
        onLoadedMetadata={onReady}
      />
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" className="mb-1 block text-xs text-brand underline">
      Abrir anexo
    </a>
  );
}

type MessagesCache = { messages?: HelpdeskMessage[]; [key: string]: unknown };

function isPlaceholderAudioBody(body?: string | null) {
  const t = (body || "").trim().toLowerCase();
  return !t || t === "-" || t === "áudio" || t === "audio";
}

function AudioTranscript({
  message,
  conversationId,
}: {
  message: HelpdeskMessage;
  conversationId: number;
}) {
  const qc = useQueryClient();
  const patchCaches = (patch: Partial<HelpdeskMessage>) => {
    const apply = (prev: MessagesCache | undefined): MessagesCache => ({
      ...prev,
      messages: (prev?.messages || []).map((row) =>
        String(row.id) === String(message.id) ? { ...row, ...patch } : row,
      ),
    });
    qc.setQueryData<MessagesCache>(["hd-messages", conversationId], apply);
    qc.setQueryData<MessagesCache>(["hd-messages", "history", conversationId], apply);
  };
  const transcribe = useMutation({
    mutationFn: () => helpdesk.transcribeMessage(conversationId, String(message.id), true),
    onMutate: () => {
      patchCaches({ transcriptionStatus: "pending", transcriptionError: null });
    },
    onSuccess: (res) => {
      patchCaches({
        transcription: res.transcription || message.transcription,
        transcriptionStatus: res.transcription ? "completed" : message.transcriptionStatus,
      });
    },
    onError: (err: Error) => {
      patchCaches({ transcriptionStatus: "failed", transcriptionError: err.message });
    },
  });

  const text = (message.transcription || "").trim();
  const status = transcribe.isPending ? "pending" : message.transcriptionStatus;

  if (text) {
    return (
      <p className="mt-1 text-xs leading-relaxed text-ink/90">
        <span className="font-medium text-muted">Transcrição: </span>
        {text}
      </p>
    );
  }
  if (status === "pending") {
    return <p className="mt-1 text-[11px] text-muted">Transcrevendo áudio…</p>;
  }
  if (status === "failed") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <p className="text-[11px] text-open">Não foi possível transcrever</p>
        <button
          type="button"
          onClick={() => transcribe.mutate()}
          className="text-[11px] font-semibold text-brand hover:underline"
        >
          Tentar de novo
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => transcribe.mutate()}
      className="mt-1 text-[11px] font-semibold text-brand hover:underline"
    >
      Transcrever
    </button>
  );
}

type AppMessagePayload = {
  ticket?: { id?: number | string } | null;
  message?: (HelpdeskMessage & { ticketId?: number | string; ticket?: { id?: number | string } | null }) | null;
};

function resolveAppMessageTicketId(payload: AppMessagePayload): number | null {
  const raw =
    payload.ticket?.id ?? payload.message?.ticketId ?? payload.message?.ticket?.id ?? null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function conversationUpdatedAtMs(c: HelpdeskConversation) {
  return Date.parse(c.updatedAt || "") || 0;
}

/** Não lidas primeiro; dentro do grupo, mais recentes no topo. */
function sortInboxConversations(rows: HelpdeskConversation[]) {
  return [...rows].sort((a, b) => {
    const unreadA = a.unreadMessages || 0;
    const unreadB = b.unreadMessages || 0;
    const hasUnreadA = unreadA > 0;
    const hasUnreadB = unreadB > 0;
    if (hasUnreadA !== hasUnreadB) return hasUnreadB ? 1 : -1;
    if (unreadA !== unreadB) return unreadB - unreadA;
    return conversationUpdatedAtMs(b) - conversationUpdatedAtMs(a);
  });
}

type ClosedPhoneGroup = {
  key: string;
  latest: HelpdeskConversation;
  items: HelpdeskConversation[];
};

function conversationPhoneKey(c: HelpdeskConversation) {
  const digits = (c.contact?.number || "").replace(/\D/g, "");
  if (digits.length >= 8) {
    const national = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
    return `n:${national}`;
  }
  if (c.contact?.id) return `c:${c.contact.id}`;
  return `t:${c.id}`;
}

function preferNamedConversation(items: HelpdeskConversation[]) {
  return items.find((c) => (c.contact?.name || "").trim()) || items[0];
}

function groupClosedByPhone(rows: HelpdeskConversation[]): ClosedPhoneGroup[] {
  const map = new Map<string, HelpdeskConversation[]>();
  for (const row of rows) {
    const key = conversationPhoneKey(row);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  const groups: ClosedPhoneGroup[] = [];
  for (const [key, items] of map) {
    const sorted = [...items].sort((a, b) => conversationUpdatedAtMs(b) - conversationUpdatedAtMs(a));
    groups.push({ key, latest: sorted[0], items: sorted });
  }
  groups.sort((a, b) => conversationUpdatedAtMs(b.latest) - conversationUpdatedAtMs(a.latest));
  return groups;
}

function uniqueQueueChips(items: HelpdeskConversation[]) {
  const seen = new Set<string>();
  const chips: { id: number | "none"; name: string; color?: string }[] = [];
  for (const c of items) {
    const key = c.queue?.id != null ? String(c.queue.id) : "none";
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push(
      c.queue
        ? { id: c.queue.id, name: c.queue.name, color: c.queue.color }
        : { id: "none", name: "Sem fila" },
    );
  }
  return chips;
}

function uniqueWhatsappNames(items: HelpdeskConversation[]) {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const c of items) {
    const name = c.whatsapp?.name?.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function applyLinkedTicketId(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: number,
  ticketId: number,
) {
  qc.setQueryData<HelpdeskConversation>(["hd-conversation", conversationId], (prev) =>
    prev ? { ...prev, computicket_ticket_id: ticketId } : prev,
  );
  patchConversationInLists(qc, conversationId, (row) => ({
    ...row,
    computicket_ticket_id: ticketId,
  }));
}

function patchConversationInLists(
  qc: ReturnType<typeof useQueryClient>,
  ticketId: number,
  patch: (row: HelpdeskConversation) => HelpdeskConversation,
) {
  const apply = (prev: ConversationListRes | undefined) => {
    if (!prev?.tickets?.length) return prev;
    let changed = false;
    const tickets = prev.tickets.map((row) => {
      if (row.id !== ticketId) return row;
      changed = true;
      return patch(row);
    });
    if (!changed) return prev;
    return { ...prev, tickets: sortInboxConversations(tickets) };
  };
  qc.setQueriesData<ConversationListRes>({ queryKey: ["hd-list"] }, apply);
  qc.setQueriesData<ConversationListRes>({ queryKey: ["hd-list-counts"] }, apply);
}

function messageLooksSettled(real: HelpdeskMessage, pending: HelpdeskMessage) {
  if (isTempMessageId(real.id)) return false;
  if (!!real.fromMe !== !!pending.fromMe) return false;
  if (!sameInternalFlags(real, pending)) return false;
  if (isMediaMessage(real) !== isMediaMessage(pending)) return false;
  if (isMediaMessage(pending)) return true;
  return normalizeMessageBody(real.body) === normalizeMessageBody(pending.body);
}

/** GET assíncrono ainda não traz o que o socket/otimista já mostrou — não descartar. */
function retainOptimisticMessages(fetched: HelpdeskMessage[], previous?: HelpdeskMessage[]) {
  if (!previous?.length) return fetched;
  const fetchedIds = new Set(fetched.map((m) => String(m.id)));
  const extras: HelpdeskMessage[] = [];
  for (const pending of previous) {
    const id = String(pending.id);
    if (fetchedIds.has(id)) continue;
    if (isTempMessageId(id)) {
      if (!fetched.some((m) => messageLooksSettled(m, pending))) extras.push(pending);
      continue;
    }
    extras.push(pending);
  }
  return extras.length ? [...fetched, ...extras] : fetched;
}

function replaceMessageAt(current: HelpdeskMessage[], idx: number, nextMsg: HelpdeskMessage) {
  const copy = [...current];
  const prevUrl = copy[idx].mediaUrl;
  if (prevUrl?.startsWith("blob:") && prevUrl !== nextMsg.mediaUrl) URL.revokeObjectURL(prevUrl);
  copy[idx] = { ...copy[idx], ...nextMsg };
  return copy;
}

/** Insere/substitui mensagem no thread sem duplicar (id real ou placeholder temp-). */
function mergeMessageIntoThread(prev: HelpdeskMessage[] | undefined, incoming: HelpdeskMessage): HelpdeskMessage[] {
  const current = prev || [];
  const incomingId = incoming.id != null ? String(incoming.id) : "";
  if (!incomingId || incomingId === "undefined" || incomingId === "null") {
    return current;
  }
  const nextMsg: HelpdeskMessage = {
    id: incomingId,
    body: incoming.body,
    fromMe: incoming.fromMe,
    createdAt: incoming.createdAt,
    ack: incoming.ack,
    mediaType: incoming.mediaType,
    mediaUrl: publicMediaUrl(incoming.mediaUrl) || incoming.mediaUrl,
    isInternal: incoming.isInternal,
    isPrivate: incoming.isPrivate,
    quotedMsg: incoming.quotedMsg,
    isDeleted: incoming.isDeleted,
    ...(incoming.transcription !== undefined ? { transcription: incoming.transcription } : {}),
    ...(incoming.transcriptionStatus !== undefined
      ? { transcriptionStatus: incoming.transcriptionStatus }
      : {}),
    ...(incoming.transcriptionError !== undefined ? { transcriptionError: incoming.transcriptionError } : {}),
  };
  const byId = current.findIndex((m) => String(m.id) === nextMsg.id);
  if (byId >= 0) return replaceMessageAt(current, byId, nextMsg);

  if (!isTempMessageId(nextMsg.id)) {
    const textTempExact = current.findIndex(
      (m) =>
        isTempMessageId(m.id) &&
        !!m.fromMe === !!nextMsg.fromMe &&
        sameInternalFlags(m, nextMsg) &&
        !isMediaMessage(m) &&
        !isMediaMessage(nextMsg) &&
        normalizeMessageBody(m.body) === normalizeMessageBody(nextMsg.body),
    );
    if (textTempExact >= 0) return replaceMessageAt(current, textTempExact, nextMsg);

    if (isMediaMessage(nextMsg)) {
      const mediaTemp = current.findIndex(
        (m) =>
          isTempMessageId(m.id) &&
          !!m.fromMe === !!nextMsg.fromMe &&
          sameInternalFlags(m, nextMsg) &&
          isMediaMessage(m),
      );
      if (mediaTemp >= 0) return replaceMessageAt(current, mediaTemp, nextMsg);
    }
  }

  return [...current, nextMsg];
}

function extractSentMessage(data: unknown): HelpdeskMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.message && typeof d.message === "object" && !Array.isArray(d.message)) {
    return extractSentMessage(d.message);
  }
  const looksLikeTicket = d.status != null && (d.queueId != null || d.contact != null || d.unreadMessages != null);
  if (looksLikeTicket) return null;
  const body = typeof d.body === "string" ? d.body : undefined;
  const hasMedia = d.mediaUrl != null || d.mediaType != null;
  if (d.id == null || (!body && !hasMedia)) return null;
  return {
    id: String(d.id),
    body,
    fromMe: d.fromMe !== false,
    mediaUrl: (d.mediaUrl as string | null | undefined) ?? null,
    mediaType: (d.mediaType as string | null | undefined) ?? null,
    createdAt: typeof d.createdAt === "string" ? d.createdAt : undefined,
    ack: typeof d.ack === "number" ? d.ack : undefined,
    isInternal: !!(d.isInternal || d.isPrivate),
    isPrivate: !!(d.isPrivate || d.isInternal),
    quotedMsg: (d.quotedMsg as HelpdeskMessage | null | undefined) ?? null,
    transcription: typeof d.transcription === "string" ? d.transcription : null,
    transcriptionStatus: typeof d.transcriptionStatus === "string" ? d.transcriptionStatus : null,
    transcriptionError: typeof d.transcriptionError === "string" ? d.transcriptionError : null,
  };
}

function readStoredFilters() {
  if (typeof window === "undefined") {
    return { queues: [] as number[], unassigned: true, unassignedOnly: false, mine: false };
  }
  try {
    const raw = window.localStorage.getItem(FILTER_KEY);
    if (!raw) return { queues: [] as number[], unassigned: true, unassignedOnly: false, mine: false };
    const parsed = JSON.parse(raw) as {
      queues?: number[];
      unassigned?: boolean;
      unassignedOnly?: boolean;
      mine?: boolean;
    };
    return {
      queues: Array.isArray(parsed.queues) ? parsed.queues.map(Number).filter((n) => Number.isFinite(n)) : [],
      unassigned: parsed.unassigned !== false,
      unassignedOnly: parsed.unassignedOnly === true,
      mine: parsed.mine === true,
    };
  } catch {
    return { queues: [] as number[], unassigned: true, unassignedOnly: false, mine: false };
  }
}

function isAssignedToEngineUser(c: HelpdeskConversation, engineUserId?: number | null) {
  if (!engineUserId) return false;
  if (c.userId != null && Number(c.userId) === engineUserId) return true;
  if (c.user?.id != null && Number(c.user.id) === engineUserId) return true;
  return false;
}

function applyQueueVisibility(
  rows: HelpdeskConversation[],
  selectedQueues: number[],
  includeUnassigned: boolean,
  unassignedOnly = false,
) {
  if (unassignedOnly) return rows.filter((t) => t.queueId == null);
  if (selectedQueues.length && includeUnassigned) return rows;
  if (selectedQueues.length && !includeUnassigned) return rows.filter((t) => t.queueId != null);
  if (!selectedQueues.length && !includeUnassigned) return rows.filter((t) => t.queueId != null);
  return rows;
}

function InboxConversationRow({
  conversation: c,
  selected,
  nested,
  displayName,
  profilePicUrl,
  queueChips,
  whatsappNames,
  sessionCount,
  expanded,
  onToggleExpand,
  onSelect,
}: {
  conversation: HelpdeskConversation;
  selected: boolean;
  nested?: boolean;
  displayName?: string;
  profilePicUrl?: string | null;
  queueChips?: { id: number | "none"; name: string; color?: string }[];
  whatsappNames?: string[];
  sessionCount?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onSelect: (c: HelpdeskConversation) => void;
}) {
  const chipItem = statusChip(c);
  const name = displayName || contactName(c);
  const queues = queueChips || uniqueQueueChips([c]);
  const connections = whatsappNames || uniqueWhatsappNames([c]);
  const grouped = (sessionCount || 0) > 1;

  return (
    <div
      className={cn(
        "flex w-full border-b border-line hover:bg-wash",
        selected && "bg-progress-bg",
        (c.unreadMessages || 0) > 0 && !selected && "bg-open-bg/40",
        nested && "bg-wash hover:bg-wash",
        nested && selected && "bg-progress-bg",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(c)}
        className={cn("flex min-w-0 flex-1 gap-3 px-3 py-3 text-left", nested && "pl-8")}
      >
      <span className="relative shrink-0">
        <UserAvatar name={name} src={publicMediaUrl(profilePicUrl ?? c.contact?.profilePicUrl)} size="sm" />
        {c.user?.name ? (
          <span
            className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-inverse text-[8px] font-bold text-on-inverse ring-2 ring-white"
            title={c.user.name}
          >
            {c.user.name.slice(0, 1).toUpperCase()}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm text-ink",
              (c.unreadMessages || 0) > 0 ? "font-bold" : "font-semibold",
            )}
            title={c.contact?.number || name}
          >
            {name}
          </span>
          {grouped ? (
            <span
              className="shrink-0 rounded-full bg-progress-bg px-1.5 py-0.5 text-[10px] font-semibold text-brand"
              title={`${sessionCount} atendimentos neste número`}
              onClick={(e) => {
                if (!onToggleExpand) return;
                e.preventDefault();
                e.stopPropagation();
                onToggleExpand();
              }}
            >
              {sessionCount}
            </span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "text-[11px]",
                (c.unreadMessages || 0) > 0 ? "font-semibold text-open" : "text-muted",
              )}
            >
              {formatClock(c.updatedAt)}
            </span>
            {(c.unreadMessages || 0) > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-open px-1.5 text-[10px] font-bold leading-none text-white">
                {(c.unreadMessages || 0) > 99 ? "99+" : c.unreadMessages}
              </span>
            ) : null}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted">
          {grouped
            ? `${sessionCount} atendimentos · ${c.user?.name || "sem atendente"}`
            : `Atendente: ${c.user?.name || "ninguém"}`}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {queues.map((queue) =>
            queue.id === "none" ? (
              <span
                key="none"
                className="rounded bg-wash px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted"
              >
                Sem fila
              </span>
            ) : (
              <span
                key={queue.id}
                className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
                style={{ background: queue.color || "#3b82f6" }}
              >
                {queue.name}
              </span>
            ),
          )}
          {connections.map((name) => (
            <span key={name} className="text-[10px] text-muted">
              {name}
            </span>
          ))}
          {(c.tags || []).map((tag) => (
            <span
              key={tag.id}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{ background: tag.color || "#6b7280" }}
            >
              {tag.name}
            </span>
          ))}
        </span>
        <span className={cn("mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium", chipItem.className)}>
          {chipItem.label}
        </span>
        {c.status === "closed" && c.rating?.answered ? (
          <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-open-bg/50 px-1.5 py-0.5 text-[10px] font-semibold text-open">
            <Star className="h-3 w-3 fill-[#f6b91a] text-[#f6b91a]" />
            {c.rating.score}/5
          </span>
        ) : c.status === "closed" && c.rating ? (
          <span className="ml-1 inline-flex rounded bg-wash px-1.5 py-0.5 text-[10px] text-muted">
            Aguardando avaliação
          </span>
        ) : null}
        <span
          className={cn(
            "mt-0.5 block truncate text-xs",
            (c.unreadMessages || 0) > 0 ? "font-semibold text-ink" : "text-muted",
          )}
        >
          {snippet(c.lastMessage)}
        </span>
      </span>
      </button>
      {onToggleExpand ? (
        <button
          type="button"
          aria-label={expanded ? "Ocultar atendimentos deste número" : "Ver atendimentos deste número"}
          title={expanded ? "Ocultar atendimentos" : "Ver atendimentos"}
          onClick={onToggleExpand}
          className="mr-2 mt-3 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-line hover:text-ink"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      ) : null}
    </div>
  );
}

export function HelpdeskWorkspace() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const isAdmin = ["admin", "administrador", "administrator"].includes((user?.role || "").toLowerCase());

  const [tab, setTab] = useState<HelpdeskTab>(() => asTab(params.get("status")));
  const [activeId, setActiveId] = useState<number | null>(() => {
    const raw = Number(params.get("c") || params.get("conversation") || "");
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  });
  const [selectedQueues, setSelectedQueues] = useState<number[]>(() =>
    (params.get("queues") || "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  const [includeUnassigned, setIncludeUnassigned] = useState(() => {
    const raw = params.get("unassigned");
    return raw !== "0" && raw !== "only";
  });
  const [unassignedOnly, setUnassignedOnly] = useState(() => params.get("unassigned") === "only");
  const [mineOnly, setMineOnly] = useState(() => params.get("mine") === "1");
  const [search, setSearch] = useState(() => params.get("q") || "");
  const [filtersReady, setFiltersReady] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [isInternal, setIsInternal] = useState(false);
  const [linkedTicket, setLinkedTicket] = useState<TicketDetail | null>(null);
  const [closeTicketOpen, setCloseTicketOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<"stop" | "add" | null>(null);
  const [ticketFlowLoading, setTicketFlowLoading] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeQuestion, setKnowledgeQuestion] = useState("");
  const [aiAction, setAiAction] = useState<"reply" | "improve" | "query" | "ticket" | null>(null);
  const [aiMenuAnchor, setAiMenuAnchor] = useState<HTMLElement | null>(null);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [ticketDefaults, setTicketDefaults] = useState<HelpdeskAiTicketDraft | null>(null);
  const [historyViewId, setHistoryViewId] = useState<number | null>(null);
  const [expandedPhoneKeys, setExpandedPhoneKeys] = useState<Set<string>>(() => new Set());
  const [sign, setSign] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(SIGN_KEY) !== "0";
  });
  const [listWidth, setListWidth] = useState(LIST_WIDTH_DEFAULT);
  const listPaneRef = useRef<HTMLElement>(null);
  const listDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const pendingResolveChatId = useRef<number | null>(null);
  const entryContinueRef = useRef(false);
  const justLinkedTicketId = useRef<number | null>(null);
  const [linkedFallback, setLinkedFallback] = useState<{ conversationId: number; ticketId: number } | null>(
    null,
  );
  activeIdRef.current = activeId;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (params.get("queues") || params.get("unassigned") || params.get("mine")) {
      setFiltersReady(true);
      return;
    }
    const stored = readStoredFilters();
    if (stored.queues.length) setSelectedQueues(stored.queues);
    setIncludeUnassigned(stored.unassignedOnly ? true : stored.unassigned);
    setUnassignedOnly(stored.unassignedOnly);
    setMineOnly(stored.mine);
    setFiltersReady(true);
    // URL vazia: hidrata do localStorage só no cliente
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!filtersReady) return;
    const q = new URLSearchParams();
    q.set("status", tab);
    if (selectedQueues.length) q.set("queues", selectedQueues.join(","));
    if (unassignedOnly) q.set("unassigned", "only");
    else if (!includeUnassigned) q.set("unassigned", "0");
    if (mineOnly) q.set("mine", "1");
    if (debouncedSearch.trim()) q.set("q", debouncedSearch.trim());
    if (activeId) q.set("c", String(activeId));
    router.replace(`/helpdesk?${q}`, { scroll: false });
    window.localStorage.setItem(
      FILTER_KEY,
      JSON.stringify({
        queues: selectedQueues,
        unassigned: includeUnassigned,
        unassignedOnly,
        mine: mineOnly,
      }),
    );
  }, [
    tab,
    selectedQueues,
    includeUnassigned,
    unassignedOnly,
    mineOnly,
    debouncedSearch,
    activeId,
    router,
    filtersReady,
  ]);

  useEffect(() => {
    window.localStorage.setItem(SIGN_KEY, sign ? "1" : "0");
  }, [sign]);

  useEffect(() => {
    setListWidth(readListWidth());
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = listDragRef.current;
      if (!drag) return;
      const parentW = listPaneRef.current?.parentElement?.clientWidth;
      setListWidth(clampListWidth(drag.startW + (e.clientX - drag.startX), parentW));
    };
    const onUp = () => {
      if (!listDragRef.current) return;
      listDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setListWidth((w) => {
        window.localStorage.setItem(LIST_WIDTH_KEY, String(w));
        return w;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => {
    setAiResult(null);
    setAiError(null);
    setKnowledgeOpen(false);
    setTicketDefaults(null);
    justLinkedTicketId.current = null;
    setLinkedFallback(null);
    setHistoryViewId(null);
  }, [activeId]);

  const health = useQuery({ queryKey: ["hd-health"], queryFn: helpdesk.health, retry: 1 });
  const session = useQuery({
    queryKey: ["hd-engine-token"],
    queryFn: helpdesk.token,
    enabled: !!health.data?.ok,
    refetchInterval: 8 * 60 * 1000,
  });

  const overview = useQuery({
    queryKey: ["hd-overview"],
    queryFn: helpdesk.overview,
    enabled: !!health.data?.ok,
    refetchInterval: 15000,
  });

  const queues = useQuery({
    queryKey: ["hd-queues"],
    queryFn: helpdesk.queues,
    enabled: !!health.data?.ok,
  });

  const connections = useQuery({
    queryKey: ["hd-connections"],
    queryFn: async () => unwrapConnections(await helpdesk.connections()),
    enabled: !!health.data?.ok,
    refetchInterval: 20000,
  });

  const assignees = useQuery({
    queryKey: ["hd-assignees"],
    queryFn: helpdesk.assignees,
    enabled: !!health.data?.ok,
  });

  const quicks = useQuery({
    queryKey: ["hd-quick-messages"],
    queryFn: async () => unwrapQuickMessages(await helpdesk.quickMessages()),
    enabled: !!health.data?.ok,
  });

  const countSource = useQuery({
    queryKey: ["hd-list-counts", tab, debouncedSearch],
    queryFn: () => helpdesk.conversations(tab, "1", debouncedSearch),
    enabled: !!health.data?.ok,
    refetchInterval: 15000,
  });

  const list = useQuery({
    queryKey: ["hd-list", tab, selectedQueues, includeUnassigned, debouncedSearch],
    queryFn: () =>
      helpdesk.conversations(tab, "1", debouncedSearch, selectedQueues.length ? selectedQueues : undefined),
    enabled: !!health.data?.ok,
    refetchInterval: 12000,
  });

  const conversation = useQuery({
    queryKey: ["hd-conversation", activeId],
    queryFn: async () => {
      const data = await helpdesk.conversation(activeId as number);
      const pendingId = justLinkedTicketId.current;
      if (!data.computicket_ticket_id && pendingId) {
        return { ...data, computicket_ticket_id: pendingId };
      }
      if (data.computicket_ticket_id) justLinkedTicketId.current = null;
      return data;
    },
    enabled: !!activeId,
  });

  useEffect(() => {
    const status = conversation.data?.status;
    if (status === "open" || status === "pending" || status === "closed") setTab(status);
  }, [conversation.data?.id, conversation.data?.status]);

  useEffect(() => {
    const convId = conversation.data?.id;
    const ticketId = conversation.data?.computicket_ticket_id;
    if (convId && ticketId) {
      setLinkedFallback({ conversationId: convId, ticketId });
    }
  }, [conversation.data?.id, conversation.data?.computicket_ticket_id]);

  const messages = useQuery({
    queryKey: ["hd-messages", activeId],
    queryFn: async () => {
      const ticketId = activeId as number;
      const res = await helpdesk.messages(ticketId);
      const fetched = unwrapMessages(res);
      const prev = qc.getQueryData<MessagesCache>(["hd-messages", ticketId]);
      return {
        ...res,
        messages: retainOptimisticMessages(fetched, prev?.messages),
      };
    },
    enabled: !!activeId,
    refetchOnMount: false,
    staleTime: 4_000,
    refetchInterval: activeId ? 5_000 : false,
  });

  const contactId = conversation.data?.contact?.id;
  const contact = useQuery({
    queryKey: ["hd-contact", contactId],
    queryFn: () => helpdesk.contact(contactId as number),
    enabled: !!contactId && contactOpen,
  });
  const contactClientLink = useQuery({
    queryKey: ["hd-contact-client-link", contactId],
    queryFn: () => helpdesk.contactClientLink(contactId as number),
    enabled: !!contactId,
  });

  const engineUserId = session.data?.engineUserId ?? null;

  const visibleTickets = useMemo(
    () =>
      sortInboxConversations(
        applyQueueVisibility(list.data?.tickets || [], selectedQueues, includeUnassigned, unassignedOnly),
      ),
    [list.data?.tickets, selectedQueues, includeUnassigned, unassignedOnly],
  );

  const mineTickets = useMemo(() => {
    if (tab === "pending") return visibleTickets;
    return visibleTickets.filter((t) => isAssignedToEngineUser(t, engineUserId));
  }, [visibleTickets, tab, engineUserId]);

  const tickets = useMemo(() => (mineOnly ? mineTickets : visibleTickets), [mineOnly, mineTickets, visibleTickets]);

  const scopeAllCount = useMemo(() => {
    const rows = applyQueueVisibility(countSource.data?.tickets || [], selectedQueues, includeUnassigned, unassignedOnly);
    return rows.length;
  }, [countSource.data?.tickets, selectedQueues, includeUnassigned, unassignedOnly]);

  const scopeMineCount = useMemo(() => {
    const rows = applyQueueVisibility(countSource.data?.tickets || [], selectedQueues, includeUnassigned, unassignedOnly);
    if (tab === "pending") return rows.length;
    return rows.filter((t) => isAssignedToEngineUser(t, engineUserId)).length;
  }, [countSource.data?.tickets, selectedQueues, includeUnassigned, unassignedOnly, tab, engineUserId]);

  const closedGroups = useMemo(
    () => (tab === "closed" ? groupClosedByPhone(tickets) : []),
    [tab, tickets],
  );

  useEffect(() => {
    if (tab !== "closed" || activeId == null) return;
    const group = closedGroups.find((g) => g.items.some((item) => item.id === activeId));
    if (!group || group.items.length < 2 || group.latest.id === activeId) return;
    setExpandedPhoneKeys((prev) => {
      if (prev.has(group.key)) return prev;
      const next = new Set(prev);
      next.add(group.key);
      return next;
    });
  }, [tab, activeId, closedGroups]);

  const selectConversation = (c: HelpdeskConversation) => {
    setActiveId(c.id);
    setError(null);
    setContactOpen(false);
    if ((c.unreadMessages || 0) > 0) {
      patchConversationInLists(qc, c.id, (row) => ({ ...row, unreadMessages: 0 }));
    }
  };

  const togglePhoneGroup = (key: string) => {
    setExpandedPhoneKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const listIsError = list.isError;
  const listErrorMessage = (list.error as Error | null)?.message;

  const queueCounts = useMemo(() => {
    const map = new Map<number | "none", number>();
    for (const t of countSource.data?.tickets || []) {
      const key = t.queueId ?? "none";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [countSource.data?.tickets]);

  const counts = {
    open: overview.data?.summary?.active ?? list.data?.count ?? 0,
    pending: overview.data?.summary?.pending ?? 0,
    closed: 0,
  };
  if (tab === "open") counts.open = list.data?.count ?? counts.open;
  if (tab === "pending") counts.pending = list.data?.count ?? counts.pending;
  if (tab === "closed") counts.closed = list.data?.count ?? 0;

  const unread = overview.data?.summary?.newMessages || 0;
  const waitingReply = tickets.filter((t) => (t.unreadMessages || 0) > 0).length;
  const allSelected = selectedQueues.length === 0 && includeUnassigned && !unassignedOnly;
  const queueFilterValue = unassignedOnly
    ? "none"
    : selectedQueues.length >= 1
      ? String(selectedQueues[0])
      : "all";
  const selectedQueueMeta = (queues.data || []).find((q) => String(q.id) === queueFilterValue);
  const queueFilterCount = unassignedOnly
    ? (queueCounts.get("none") ?? 0)
    : selectedQueues.length >= 1
      ? (queueCounts.get(selectedQueues[0]) ?? 0)
      : (countSource.data?.tickets?.length ?? 0);
  const connected = (connections.data || []).some((c) => (c.status || "").toLowerCase() === "connected");
  const connectionLabel = connections.isError
    ? "Status da conexão indisponível"
    : connected
      ? "WhatsApp conectado"
      : (connections.data || []).length
        ? "WhatsApp desconectado"
        : "Sem conexão WhatsApp";

  const invalidateInbox = (id?: number) => {
    qc.invalidateQueries({ queryKey: ["hd-list"] });
    qc.invalidateQueries({ queryKey: ["hd-list-counts"] });
    qc.invalidateQueries({ queryKey: ["hd-overview"] });
    qc.invalidateQueries({ queryKey: ["dashboard-helpdesk-ratings"] });
    if (id) {
      qc.invalidateQueries({ queryKey: ["hd-conversation", id] });
      qc.invalidateQueries({ queryKey: ["hd-messages", id] });
    }
  };

  const assume = useMutation({
    mutationFn: (id: number) => helpdesk.assume(id),
    onSuccess: (ticket) => {
      setTab("open");
      setActiveId(ticket.id);
      invalidateInbox(ticket.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const resolve = useMutation({
    mutationFn: (id: number) => helpdesk.resolve(id),
    onSuccess: (ticket) => {
      setActiveId(null);
      setTab("closed");
      invalidateInbox();
      if (ticket.rating_warning) setError(ticket.rating_warning);
    },
    onError: (e: Error) => setError(e.message),
  });
  const resendRating = useMutation({
    mutationFn: (id: number) => helpdesk.resendRating(id),
    onSuccess: (_, id) => {
      invalidateInbox(id);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const abortTicketCloseFlow = () => {
    pendingResolveChatId.current = null;
    entryContinueRef.current = false;
    setEntryMode(null);
    setCloseTicketOpen(false);
    setLinkedTicket(null);
  };

  const openCloseTicketFlow = async (conversationId: number, ticketId: number) => {
    setTicketFlowLoading(true);
    setError(null);
    try {
      const ticket = await flask.get<TicketDetail>(`/tickets/api/${ticketId}`);
      if (ticket.status === "fechado" || ticket.status === "cancelado") {
        if (window.confirm("Resolver esta conversa? O chamado vinculado já está encerrado.")) {
          resolve.mutate(conversationId);
        }
        return;
      }
      pendingResolveChatId.current = conversationId;
      setLinkedTicket(ticket);
      const entries = ticket.time_entries || [];
      if (ticket.status === "em_andamento") {
        setCloseTicketOpen(false);
        setEntryMode("stop");
      } else if (entries.length === 0) {
        setCloseTicketOpen(false);
        setEntryMode("add");
      } else {
        setEntryMode(null);
        setCloseTicketOpen(true);
      }
    } catch (e) {
      abortTicketCloseFlow();
      setError(e instanceof Error ? e.message : "Erro ao carregar chamado vinculado");
    } finally {
      setTicketFlowLoading(false);
    }
  };

  const handleResolverClick = () => {
    const conv = conversation.data;
    if (!conv || conv.status !== "open") return;
    const ticketId =
      conv.computicket_ticket_id ??
      (linkedFallback?.conversationId === conv.id ? linkedFallback.ticketId : null);
    if (!ticketId) {
      if (window.confirm("Resolver esta conversa?")) resolve.mutate(conv.id);
      return;
    }
    void openCloseTicketFlow(conv.id, ticketId);
  };

  const onLinkedTicketClosed = () => {
    const chatId = pendingResolveChatId.current;
    pendingResolveChatId.current = null;
    if (chatId) resolve.mutate(chatId);
  };
  const reopen = useMutation({
    mutationFn: (id: number) => helpdesk.reopen(id),
    onSuccess: (ticket) => {
      setTab(ticket?.status === "pending" ? "pending" : "open");
      if (ticket?.id) setActiveId(ticket.id);
      invalidateInbox(ticket?.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const giveBack = useMutation({
    mutationFn: (id: number) => helpdesk.pending(id),
    onSuccess: () => {
      setActiveId(null);
      setTab("pending");
      invalidateInbox();
    },
    onError: (e: Error) => setError(e.message),
  });
  const transfer = useMutation({
    mutationFn: (payload: TransferPayload) => helpdesk.transfer(activeId as number, payload),
    onSuccess: (ticket) => {
      setTransferOpen(false);
      if (ticket?.status === "pending") {
        setTab("pending");
        setActiveId(ticket.id);
      } else if (ticket?.id) {
        setTab("open");
        setActiveId(ticket.id);
      }
      invalidateInbox(ticket?.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const send = useMutation({
    mutationFn: (vars: { ticketId: number; body: string; isInternal: boolean; rawText: string }) =>
      helpdesk.send(vars.ticketId, vars.body, { isInternal: vars.isInternal }),
    onMutate: async (vars) => {
      // Limpa o draft antes do await para bloquear reenvio (Enter duplo) no mesmo ciclo.
      setText("");
      setIsInternal(false);
      setError(null);
      const previous = qc.getQueryData<MessagesCache>(["hd-messages", vars.ticketId]);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: HelpdeskMessage = {
        id: tempId,
        body: vars.body,
        fromMe: true,
        createdAt: new Date().toISOString(),
        ack: 0,
        ...(vars.isInternal ? { isInternal: true, isPrivate: true } : {}),
      };
      qc.setQueryData<MessagesCache>(["hd-messages", vars.ticketId], (prev) => ({
        ...prev,
        messages: mergeMessageIntoThread(prev?.messages, optimistic),
      }));
      return { previous, ticketId: vars.ticketId, tempId, rawText: vars.rawText, wasInternal: vars.isInternal };
    },
    onSuccess: (data, vars, ctx) => {
      const sent = extractSentMessage(data);
      if (sent) {
        qc.setQueryData<MessagesCache>(["hd-messages", vars.ticketId], (prev) => ({
          ...prev,
          messages: mergeMessageIntoThread(
            (prev?.messages || []).map((m) => (ctx?.tempId && m.id === ctx.tempId ? { ...m, ...sent } : m)),
            sent,
          ),
        }));
      }
      // Não invalidar hd-messages aqui: o POST costuma retornar antes do job persistir a msg.
      qc.invalidateQueries({ queryKey: ["hd-list"] });
      qc.invalidateQueries({ queryKey: ["hd-list-counts"] });
      qc.invalidateQueries({ queryKey: ["hd-overview"] });
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous && ctx.ticketId) {
        qc.setQueryData(["hd-messages", ctx.ticketId], ctx.previous);
      }
      if (ctx?.rawText != null) setText(ctx.rawText);
      if (ctx?.wasInternal) setIsInternal(true);
      setError(e.message);
    },
  });
  const sendFile = useMutation({
    mutationFn: (vars: { ticketId: number; file: File; body: string; rawText: string }) =>
      helpdesk.sendMedia(vars.ticketId, vars.file, vars.body),
    onMutate: async (vars) => {
      setText("");
      setError(null);
      const previous = qc.getQueryData<MessagesCache>(["hd-messages", vars.ticketId]);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const mediaType = vars.file.type || "application/octet-stream";
      const objectUrl = isInlinePlayableMedia(mediaType, vars.file.name)
        ? URL.createObjectURL(vars.file)
        : null;
      const optimistic: HelpdeskMessage = {
        id: tempId,
        body: vars.body || vars.file.name,
        fromMe: true,
        createdAt: new Date().toISOString(),
        ack: 0,
        mediaType,
        mediaUrl: objectUrl,
      };
      qc.setQueryData<MessagesCache>(["hd-messages", vars.ticketId], (prev) => ({
        ...prev,
        messages: mergeMessageIntoThread(prev?.messages, optimistic),
      }));
      return { previous, ticketId: vars.ticketId, tempId, objectUrl, rawText: vars.rawText };
    },
    onSuccess: (data, vars) => {
      const sent = extractSentMessage(data);
      if (sent) {
        qc.setQueryData<MessagesCache>(["hd-messages", vars.ticketId], (prev) => ({
          ...prev,
          messages: mergeMessageIntoThread(prev?.messages, sent),
        }));
      }
      // Media sync costuma persistir antes do 200; ainda assim evita refetch que apague o otimista.
      qc.invalidateQueries({ queryKey: ["hd-list"] });
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.objectUrl) URL.revokeObjectURL(ctx.objectUrl);
      if (ctx?.previous && ctx.ticketId) {
        qc.setQueryData(["hd-messages", ctx.ticketId], ctx.previous);
      }
      if (ctx?.rawText != null) setText(ctx.rawText);
      setError(e.message);
    },
  });
  const saveContact = useMutation({
    mutationFn: (payload: { name: string; email: string; notes: string }) => {
      const extras = [...(contact.data?.extraInfo || [])];
      const idx = extras.findIndex((e) => (e.name || "").toLowerCase() === "observações");
      if (idx >= 0) extras[idx] = { ...extras[idx], name: "Observações", value: payload.notes };
      else extras.push({ name: "Observações", value: payload.notes });
      return helpdesk.updateContact(contactId as number, { name: payload.name, email: payload.email, extraInfo: extras });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hd-contact", contactId] });
      if (activeId) qc.invalidateQueries({ queryKey: ["hd-conversation", activeId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const threadTailId = messages.data?.messages?.length
    ? messages.data.messages[messages.data.messages.length - 1]?.id
    : null;

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
    };
    pin();
    requestAnimationFrame(pin);
  }, [messages.data?.messages?.length, threadTailId, activeId]);

  useEffect(() => {
    const engine: EngineSession | undefined = session.data;
    if (!engine?.token || !engine.engineUrl) return;
    const socketUrl = resolveEngineSocketUrl(engine.engineUrl);
    const socket = io(
      socketUrl,
      engineSocketOptions(engine.token, { sameOrigin: isEngineSocketSameOrigin(socketUrl) }),
    );
    socketRef.current = socket;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["hd-list"] });
      qc.invalidateQueries({ queryKey: ["hd-list-counts"] });
      qc.invalidateQueries({ queryKey: ["hd-overview"] });
      // Badge: reconciliar com delay para não zerar o bump otimista do NotificationCenter.
      window.setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["helpdesk-nav-badge"] });
      }, 4000);
    };
    const joinRooms = () => {
      socket.emit("joinTickets", "pending");
      socket.emit("joinTickets", "open");
      socket.emit("joinTickets", "closed");
      socket.emit("joinNotification");
      if (activeIdRef.current) socket.emit("joinChatBox", String(activeIdRef.current));
    };
    // `connect` dispara antes do servidor registrar join*; `ready` é o sinal certo.
    socket.on("connect", joinRooms);
    socket.on("ready", joinRooms);
    socket.on(`company-${engine.companyId}-ticket`, refresh);
    socket.on(`company-${engine.companyId}-appMessage`, (payload: AppMessagePayload) => {
      const ticketId = resolveAppMessageTicketId(payload);
      const openId = activeIdRef.current;
      const incoming = payload.message;
      const fromClient = !!incoming && !incoming.fromMe && !(incoming.isInternal || incoming.isPrivate);

      if (ticketId && fromClient && ticketId !== openId) {
        const preview =
          snippet(incoming.body) ||
          (incoming.mediaType ? `[${incoming.mediaType}]` : "") ||
          "Nova mensagem";
        patchConversationInLists(qc, ticketId, (row) => ({
          ...row,
          unreadMessages: Math.max(0, row.unreadMessages || 0) + 1,
          lastMessage: preview || row.lastMessage,
          updatedAt: incoming.createdAt || new Date().toISOString(),
        }));
      }

      refresh();
      if (ticketId && openId && ticketId === openId && incoming?.id) {
        qc.setQueryData<MessagesCache>(["hd-messages", openId], (prev) => ({
          ...prev,
          messages: mergeMessageIntoThread(prev?.messages, incoming as HelpdeskMessage),
        }));
        patchConversationInLists(qc, ticketId, (row) => ({
          ...row,
          unreadMessages: 0,
          lastMessage: snippet(incoming.body) || row.lastMessage,
          updatedAt: incoming.createdAt || row.updatedAt,
        }));
      }
    });
    socket.on(`company-${engine.companyId}-whatsappSession`, () => {
      qc.invalidateQueries({ queryKey: ["hd-connections"] });
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session.data?.token, session.data?.engineUrl, session.data?.companyId, qc]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !activeId) return;
    socket.emit("joinChatBox", String(activeId));
    return () => {
      socket.emit("leaveChatBox", String(activeId));
    };
  }, [activeId, session.data?.token]);

  const current = conversation.data;
  const linkedTicketId =
    current?.computicket_ticket_id ??
    (linkedFallback && linkedFallback.conversationId === current?.id ? linkedFallback.ticketId : null);
  const canReply = current?.status === "open";
  const assignedName = current?.user?.name;
  const thread = messages.data?.messages || [];
  const quickItems = quicks.data || [];
  const slash = text.startsWith("/") ? text.slice(1).toLowerCase() : "";
  const quickMatches = slash
    ? quickItems.filter((q) => q.shortcode.toLowerCase().includes(slash) || q.message.toLowerCase().includes(slash))
    : quickOpen
      ? quickItems
      : [];

  const grouped = useMemo(() => {
    const out: { day: string; items: HelpdeskMessage[] }[] = [];
    for (const msg of thread) {
      const day = formatDay(msg.createdAt) || "";
      const last = out[out.length - 1];
      if (!last || last.day !== day) out.push({ day, items: [msg] });
      else last.items.push(msg);
    }
    return out;
  }, [thread]);

  const engineDown = health.isFetched && !health.data?.ok;

  function setQueueFilter(value: string) {
    if (value === "all") {
      setSelectedQueues([]);
      setIncludeUnassigned(true);
      setUnassignedOnly(false);
      return;
    }
    if (value === "none") {
      setSelectedQueues([]);
      setIncludeUnassigned(true);
      setUnassignedOnly(true);
      return;
    }
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0) return;
    setSelectedQueues([id]);
    setIncludeUnassigned(false);
    setUnassignedOnly(false);
  }

  function insertQuick(item: QuickMessage) {
    setText(item.message);
    setQuickOpen(false);
  }

  async function suggestReply() {
    if (!current) return;
    setAiAction("reply");
    setAiError(null);
    try {
      const result = await helpdesk.aiSuggestReply(current.id);
      setAiResult({
        kind: "text",
        title: "Sugestão de resposta",
        draft: result.draft || "",
        sources: result.sources || [],
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Não foi possível gerar a sugestão");
    } finally {
      setAiAction(null);
    }
  }

  async function improveText() {
    if (!current || !text.trim()) return;
    setAiAction("improve");
    setAiError(null);
    try {
      const result = await helpdesk.aiImprove(current.id, text.trim());
      setAiResult({
        kind: "text",
        title: "Texto melhorado",
        draft: result.draft || "",
        sources: result.sources || [],
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Não foi possível melhorar o texto");
    } finally {
      setAiAction(null);
    }
  }

  async function askKnowledge() {
    if (!knowledgeQuestion.trim()) return;
    setAiAction("query");
    setAiError(null);
    try {
      const result = await helpdesk.aiQuery(knowledgeQuestion.trim(), current?.id);
      setAiResult({
        kind: "text",
        title: "Consulta ao conhecimento",
        draft: result.draft || "",
        sources: result.sources || [],
      });
      setKnowledgeOpen(false);
      setKnowledgeQuestion("");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Não foi possível consultar o conhecimento");
    } finally {
      setAiAction(null);
    }
  }

  async function suggestTicket() {
    if (!current) return;
    setAiAction("ticket");
    setAiError(null);
    try {
      const result = await helpdesk.aiSuggestTicket(current.id);
      const link = contactClientLink.data?.link || null;
      setAiResult({
        kind: "ticket",
        title: "Sugestão de chamado",
        ticket: ticketDefaultsFromConversation(current, link, result.ticket),
        sources: result.sources || [],
      });
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Não foi possível gerar o rascunho do chamado");
    } finally {
      setAiAction(null);
    }
  }

  return (
    <div className="relative flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <aside
          ref={listPaneRef}
          style={{ width: listWidth }}
          className="relative flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-r border-line"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                connected ? "bg-done-bg text-done" : "bg-open-bg text-open",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-done" : "bg-open")} />
              {connectionLabel}
            </span>
            {isAdmin ? (
              <Link
                href="/configuracoes?tab=whatsapp&section=conexoes"
                className="rounded-md p-1 text-brand hover:bg-progress-bg"
                title="Configurar WhatsApp"
              >
                <Settings className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
          <div className="flex border-b border-line">
            {TAB_META.map((t) => {
              const count = t.key === "open" ? counts.open : t.key === "pending" ? counts.pending : counts.closed;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    setActiveId(null);
                    setError(null);
                  }}
                  className={cn(
                    "relative flex-1 truncate px-1 py-3 text-[11px] font-semibold uppercase tracking-wide",
                    active ? "text-brand" : "text-muted hover:text-ink",
                  )}
                >
                  {t.label}
                  {t.key !== "closed" && count > 0 ? (
                    <span className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-open px-1.5 text-[10px] text-white">
                      {count}
                    </span>
                  ) : null}
                  {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand" /> : null}
                </button>
              );
            })}
          </div>

          <div className="border-b border-line px-3 py-2">
            <button
              type="button"
              onClick={() => setNewConversationOpen(true)}
              disabled={engineDown}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MessageSquarePlus className="h-4 w-4 shrink-0" />
              Nova conversa
            </button>
          </div>

          <div className="px-3 py-2">
            <label className="flex items-center gap-2 rounded-lg border border-line bg-wash px-2 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar conversa ou número"
                className="min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-muted"
              />
            </label>
          </div>

          <div className="space-y-2 border-b border-line px-3 pb-3">
            {tab !== "pending" ? (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Atribuição</p>
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-wash p-0.5">
                  <button
                    type="button"
                    onClick={() => setMineOnly(true)}
                    className={cn(
                      "rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors",
                      mineOnly ? "bg-inverse text-on-inverse shadow-sm" : "text-muted hover:text-ink",
                    )}
                    title="Conversas atribuídas a você nesta aba"
                  >
                    Meus
                    <span className="ml-1 tabular-nums opacity-80">{scopeMineCount}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMineOnly(false)}
                    className={cn(
                      "rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors",
                      !mineOnly ? "bg-brand text-white shadow-sm" : "text-muted hover:text-ink",
                    )}
                    title="Todas as conversas visíveis nesta aba"
                  >
                    Todos
                    <span className="ml-1 tabular-nums opacity-80">{scopeAllCount}</span>
                  </button>
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Fila</p>
              <label className="relative block">
                <span className="sr-only">Filtrar por fila</span>
                {selectedQueueMeta?.color || queueFilterValue === "none" ? (
                  <span
                    className="pointer-events-none absolute left-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
                    style={{
                      background:
                        queueFilterValue === "none" ? "#6b7280" : selectedQueueMeta?.color || "#3b82f6",
                    }}
                  />
                ) : null}
                <select
                  value={queueFilterValue}
                  onChange={(e) => setQueueFilter(e.target.value)}
                  className={cn(
                    "w-full appearance-none rounded-lg border border-line bg-wash py-2 pr-14 text-xs font-medium text-ink outline-none focus:border-brand",
                    selectedQueueMeta?.color || queueFilterValue === "none" ? "pl-6" : "pl-2.5",
                  )}
                >
                  <option value="all">
                    Todas as filas ({scopeAllCount})
                  </option>
                  <option value="none">Sem fila ({queueCounts.get("none") ?? 0})</option>
                  {(queues.data || []).map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name} ({queueCounts.get(q.id) ?? 0})
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  <span className="rounded-full bg-progress-bg px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                    {queueFilterCount}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted" />
                </span>
              </label>
            </div>
          </div>
          <p className="px-3 pb-2 text-[11px] text-muted">
            {mineOnly && tab !== "pending" ? "Filtro Meus · " : ""}
            {tab === "closed"
              ? `${closedGroups.length} contato${closedGroups.length === 1 ? "" : "s"}${
                  tickets.length !== closedGroups.length
                    ? ` · ${tickets.length} atendimento${tickets.length === 1 ? "" : "s"}`
                    : ""
                }`
              : `${tickets.length} conversa${tickets.length === 1 ? "" : "s"}`}
            {unread ? ` · ${unread} não lida` : ""}
            {waitingReply ? ` · ${waitingReply} aguardando resposta` : ""}
          </p>

          {engineDown ? (
            <div className="mx-3 mb-2 rounded-lg bg-open-bg px-3 py-2 text-xs text-open">
              Engine WhatsApp offline. Suba o serviço e recarregue.
            </div>
          ) : null}
          {error ? <p className="px-3 pb-2 text-xs text-open">{error}</p> : null}

          <div className="min-h-0 flex-1 basis-0 overflow-y-auto overscroll-contain">
            {listIsError ? (
              <p className="px-4 py-10 text-center text-sm text-open">
                Não foi possível carregar as conversas. {listErrorMessage}
              </p>
            ) : tickets.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                {mineOnly
                  ? tab === "pending"
                    ? "Nenhuma conversa aguardando nas filas selecionadas"
                    : "Nenhuma conversa sua nesta aba"
                  : allSelected
                    ? "Nenhuma conversa nesta aba"
                    : unassignedOnly
                      ? "Nenhuma conversa sem fila"
                      : "Nenhuma conversa nestas filas"}
              </p>
            ) : tab === "closed" ? (
              closedGroups.map((group) => {
                const named = preferNamedConversation(group.items);
                const grouped = group.items.length > 1;
                const expanded = expandedPhoneKeys.has(group.key);
                const anySelected = group.items.some((item) => item.id === activeId);
                return (
                  <div key={group.key}>
                    <InboxConversationRow
                      conversation={group.latest}
                      selected={group.latest.id === activeId || (!expanded && anySelected)}
                      displayName={contactName(named)}
                      profilePicUrl={named.contact?.profilePicUrl}
                      queueChips={uniqueQueueChips(group.items)}
                      whatsappNames={uniqueWhatsappNames(group.items)}
                      sessionCount={grouped ? group.items.length : undefined}
                      expanded={expanded}
                      onToggleExpand={grouped ? () => togglePhoneGroup(group.key) : undefined}
                      onSelect={selectConversation}
                    />
                    {expanded
                      ? group.items.slice(1).map((item) => (
                          <InboxConversationRow
                            key={item.id}
                            conversation={item}
                            selected={activeId === item.id}
                            nested
                            onSelect={selectConversation}
                          />
                        ))
                      : null}
                  </div>
                );
              })
            ) : (
              tickets.map((c) => (
                <InboxConversationRow
                  key={c.id}
                  conversation={c}
                  selected={activeId === c.id}
                  onSelect={selectConversation}
                />
              ))
            )}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar lista de conversas"
            title="Arraste para ajustar a largura"
            className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-brand/40 active:bg-brand/50"
            onPointerDown={(e) => {
              e.preventDefault();
              listDragRef.current = { startX: e.clientX, startW: listWidth };
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          />
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden bg-chat">
          {current ? (
            <div
              key={current.id}
              className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden"
            >
              <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-chat-border bg-surface px-4 py-2.5">
                <div className="flex min-w-0 flex-1 basis-44 flex-col gap-1 overflow-hidden">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-3 text-left"
                    onClick={() => setContactOpen(true)}
                    title="Ver contato"
                  >
                    <span className="shrink-0">
                      <UserAvatar name={contactName(current)} src={publicMediaUrl(current.contact?.profilePicUrl)} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {contactName(current)} #{current.id}
                      </p>
                      <p className="truncate text-xs text-muted">
                        Atribuído à: {assignedName || "ninguém"}
                        {current.queue?.name ? ` · ${current.queue.name}` : " · sem fila"}
                      </p>
                    </div>
                  </button>
                  {linkedTicketId ? (
                    <Link
                      href={`/tickets/${linkedTicketId}`}
                      className="ml-[3.25rem] w-fit max-w-[calc(100%-3.25rem)] truncate rounded-md bg-progress-bg px-2 py-0.5 text-[11px] font-semibold text-brand hover:underline"
                    >
                      Chamado #{linkedTicketId}
                    </Link>
                  ) : null}
                </div>
                <div className="relative ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
                  {current.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => assume.mutate(current.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash"
                    >
                      <Hand className="h-3.5 w-3.5 shrink-0" />
                      Assumir
                    </button>
                  ) : null}
                  {current.status !== "closed" ? (
                    <button
                      type="button"
                      onClick={() => setTransferOpen(true)}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                      Transferir
                    </button>
                  ) : null}
                  {current.status === "open" ? (
                    <button
                      type="button"
                      onClick={() => giveBack.mutate(current.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash"
                    >
                      <Undo2 className="h-3.5 w-3.5 shrink-0" />
                      Devolver
                    </button>
                  ) : null}
                  {current.status !== "closed" && !linkedTicketId ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTicketDefaults(
                          ticketDefaultsFromConversation(current, contactClientLink.data?.link || null),
                        );
                        setCreateOpen(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash"
                    >
                      <Ticket className="h-3.5 w-3.5 shrink-0" />
                      Abrir chamado
                    </button>
                  ) : null}
                  {current.status === "open" ? (
                    <button
                      type="button"
                      disabled={ticketFlowLoading || resolve.isPending}
                      onClick={handleResolverClick}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5 shrink-0" />
                      {ticketFlowLoading ? "Carregando…" : "Resolver"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setContactOpen(true)}
                    className="rounded-lg p-1.5 text-muted hover:bg-wash"
                    title="Dados do contato"
                    aria-label="Dados do contato"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              </header>

              {current.status === "closed" && current.rating ? (
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-chat-border bg-open-bg/30 px-4 py-2 text-xs">
                  {current.rating.answered ? (
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-1 font-semibold text-open">
                        <Star className="h-4 w-4 fill-[#f6b91a] text-[#f6b91a]" />
                        Atendimento avaliado com {current.rating.score}/5
                      </span>
                      {current.rating.comment ? (
                        <span className="ml-2 text-muted">“{current.rating.comment}”</span>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <span className="text-muted">Pesquisa enviada; aguardando resposta do cliente.</span>
                      <button
                        type="button"
                        onClick={() => resendRating.mutate(current.id)}
                        disabled={resendRating.isPending}
                        className="shrink-0 font-semibold text-brand hover:underline disabled:opacity-50"
                      >
                        {resendRating.isPending ? "Reenviando…" : "Reenviar pesquisa"}
                      </button>
                    </>
                  )}
                </div>
              ) : null}

              {(current.history || []).length > 0 ? (
                <ConversationHistoryStrip
                  items={current.history || []}
                  onOpen={(id) => setHistoryViewId(id)}
                />
              ) : null}

              <div
                ref={threadRef}
                className="min-h-0 flex-1 basis-0 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none]"
              >
                {messages.isError ? (
                  <p className="rounded-lg bg-open-bg px-3 py-2 text-center text-xs text-open">
                    Não foi possível carregar as mensagens. {(messages.error as Error).message}
                  </p>
                ) : null}
                {messages.isSuccess && grouped.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted">Nenhuma mensagem nesta conversa</p>
                ) : null}
                {grouped.map((group) => (
                  <div key={group.day}>
                    {group.day ? (
                      <p className="mb-3 text-center">
                        <span className="rounded-full bg-surface/80 px-3 py-1 text-[11px] text-muted shadow-sm">{group.day}</span>
                      </p>
                    ) : null}
                    {group.items.map((m, idx) => {
                      const system = m.isInternal || m.isPrivate;
                      const mine = !!m.fromMe && !system;
                      const audio = !!(m.mediaUrl && mediaKind(m.mediaType, m.mediaUrl) === "audio");
                      return (
                        <div key={`${m.id}-${idx}`} className={cn("mb-2 flex", system ? "justify-center" : mine ? "justify-end" : "justify-start")}>
                          <div
                            className={cn(
                              "max-w-[75%] rounded-lg px-3 py-1.5 text-sm shadow-sm",
                              audio && "w-[min(18rem,75%)]",
                              system
                                ? "bg-note text-center text-xs text-note-fg"
                                : mine
                                  ? "rounded-tr-none bg-bubble-out text-ink"
                                  : "rounded-tl-none bg-bubble-in text-ink",
                            )}
                          >
                            {system ? <p className="mb-1 text-[10px] font-semibold uppercase">Nota interna</p> : null}
                            {m.quotedMsg?.body ? (
                              <p className="mb-1 border-l-2 border-brand/50 pl-2 text-[11px] text-muted">{snippet(m.quotedMsg.body)}</p>
                            ) : null}
                            {m.mediaUrl ? (
                              <ThreadMedia
                                mediaUrl={m.mediaUrl}
                                mediaType={m.mediaType}
                                onReady={() => {
                                  const el = threadRef.current;
                                  if (el) el.scrollTop = el.scrollHeight;
                                }}
                              />
                            ) : null}
                            {audio && current?.id ? (
                              <AudioTranscript message={m} conversationId={current.id} />
                            ) : null}
                            {m.body && !(audio && isPlaceholderAudioBody(m.body)) ? (
                              <p className="whitespace-pre-wrap break-words">{m.body}</p>
                            ) : null}
                            <p className="mt-0.5 text-right text-[10px] text-muted">{formatClock(m.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {canReply ? (
                <form
                  className="relative shrink-0 border-t border-chat-border bg-chat-composer px-3 py-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (send.isPending || !activeId || !text.trim()) return;
                    const rawText = text;
                    const sendingInternal = isInternal;
                    const body = withAgentSignature(rawText, user?.name, sign, sendingInternal);
                    if (!body.trim()) return;
                    send.mutate({
                      ticketId: activeId,
                      body,
                      isInternal: sendingInternal,
                      rawText,
                    });
                  }}
                >
                  {quickMatches.length ? (
                    <div className="absolute inset-x-3 bottom-full z-10 mb-1 max-h-48 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
                      {quickMatches.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="block w-full px-3 py-2 text-left hover:bg-wash"
                          onClick={() => insertQuick(item)}
                        >
                          <span className="text-xs font-semibold text-brand">/{item.shortcode}</span>
                          <span className="mt-0.5 block truncate text-sm text-ink">{item.message}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {aiResult ? (
                    <AiDraftPanel
                      result={aiResult}
                      onDraftChange={(draft) =>
                        setAiResult((value) => (value?.kind === "text" ? { ...value, draft } : value))
                      }
                      onApplyText={() => {
                        if (aiResult.kind === "text") setText(aiResult.draft);
                        setAiResult(null);
                      }}
                      onApplyTicket={() => {
                        if (aiResult.kind !== "ticket") return;
                        if (linkedTicketId) {
                          setAiError("Esta conversa já possui um chamado ativo.");
                          setAiResult(null);
                          return;
                        }
                        setTicketDefaults(
                          ticketDefaultsFromConversation(
                            current,
                            contactClientLink.data?.link || null,
                            aiResult.ticket,
                          ),
                        );
                        setCreateOpen(true);
                      }}
                      onClose={() => setAiResult(null)}
                    />
                  ) : null}
                  {aiError ? (
                    <div className="mb-2 flex items-start justify-between gap-2 rounded-lg bg-open-bg px-3 py-2 text-xs text-open">
                      <span>{aiError}</span>
                      <button type="button" onClick={() => setAiError(null)} aria-label="Fechar erro">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Smile className="h-5 w-5 text-muted" />
                    <button
                      type="button"
                      onClick={() => setQuickOpen((v) => !v)}
                      className={cn("text-muted hover:text-ink", quickOpen && "text-brand")}
                      aria-label="Mensagens rápidas"
                      title="Mensagens rápidas"
                    >
                      <Zap className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="text-muted hover:text-ink"
                      aria-label="Anexar"
                    >
                      <Paperclip className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => setAiMenuAnchor((cur) => (cur ? null : e.currentTarget))}
                      className={cn(
                        "text-muted hover:text-ink",
                        (aiMenuAnchor || aiAction) && "text-brand",
                      )}
                      aria-label="Copiloto"
                      title="Copiloto"
                      aria-expanded={!!aiMenuAnchor}
                      aria-haspopup="menu"
                    >
                      {aiAction ? (
                        <LoaderCircle className="h-5 w-5 animate-spin" />
                      ) : (
                        <Bot className="h-5 w-5" />
                      )}
                    </button>
                    {aiMenuAnchor ? (
                      <FloatingMenu
                        anchor={aiMenuAnchor}
                        width={220}
                        onClose={() => setAiMenuAnchor(null)}
                      >
                        <div className="border-b border-line px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Copiloto
                        </div>
                        <AiMenuItem
                          label="Sugerir resposta"
                          pending={aiAction === "reply"}
                          disabled={aiAction !== null}
                          onClick={() => {
                            setAiMenuAnchor(null);
                            void suggestReply();
                          }}
                        />
                        <AiMenuItem
                          label="Melhorar texto"
                          pending={aiAction === "improve"}
                          disabled={aiAction !== null || !text.trim()}
                          onClick={() => {
                            setAiMenuAnchor(null);
                            void improveText();
                          }}
                        />
                        <AiMenuItem
                          label="Consultar conhecimento"
                          icon={<BookOpen className="h-3.5 w-3.5" />}
                          pending={aiAction === "query"}
                          disabled={aiAction !== null}
                          onClick={() => {
                            setAiMenuAnchor(null);
                            setAiError(null);
                            setKnowledgeOpen(true);
                          }}
                        />
                        <AiMenuItem
                          label="Gerar ticket"
                          icon={<FilePlus2 className="h-3.5 w-3.5" />}
                          pending={aiAction === "ticket"}
                          disabled={aiAction !== null}
                          onClick={() => {
                            setAiMenuAnchor(null);
                            void suggestTicket();
                          }}
                        />
                      </FloatingMenu>
                    ) : null}
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && activeId) {
                          const tooBig = helpdeskMediaSizeError(file);
                          if (tooBig) {
                            setError(tooBig);
                          } else {
                            sendFile.mutate({
                              ticketId: activeId,
                              file,
                              body: withAgentSignature(text, user?.name, sign, isInternal),
                              rawText: text,
                            });
                          }
                        }
                        e.target.value = "";
                      }}
                    />
                    <input
                      value={text}
                      onChange={(e) => {
                        setText(e.target.value);
                        if (!e.target.value.startsWith("/")) setQuickOpen(false);
                      }}
                      className="flex-1 rounded-lg border-0 bg-surface px-3 py-2 text-sm shadow-sm"
                      placeholder={isInternal ? "Nota interna (não vai para o WhatsApp)" : "Digite uma mensagem ou /atalho"}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setIsInternal((v) => !v)}
                      className={cn("rounded-md p-1.5", isInternal ? "bg-note text-note-fg" : "text-muted hover:text-ink")}
                      title="Mensagem interna"
                    >
                      <Lock className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSign((v) => !v)}
                      className={cn("rounded-md p-1.5", sign ? "bg-progress-bg text-brand" : "text-muted hover:text-ink")}
                      title={sign ? "Assinatura ligada" : "Assinatura desligada"}
                    >
                      <PenLine className="h-4 w-4" />
                    </button>
                    <button
                      type="submit"
                      disabled={send.isPending || !text.trim()}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white disabled:opacity-40"
                      aria-label="Enviar"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex shrink-0 items-center justify-center gap-3 border-t border-chat-border bg-surface px-4 py-3 text-xs text-muted">
                  {current.status === "closed" ? (
                    <>
                      <span>Conversa finalizada — somente leitura</span>
                      <button
                        type="button"
                        onClick={() => reopen.mutate(current.id)}
                        disabled={reopen.isPending}
                        className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-wash disabled:opacity-40"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {reopen.isPending ? "Reabrindo…" : "Reabrir"}
                      </button>
                    </>
                  ) : (
                    <span>Assuma ou transfira a conversa para responder</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center text-muted">
              <p className="text-lg font-semibold text-navy">Selecione uma conversa</p>
              <p className="mt-1 text-sm">Escolha um atendimento na lista à esquerda para ver as mensagens.</p>
            </div>
          )}
        </section>

        {contactOpen && current ? (
          <ContactDrawer
            conversation={current}
            detail={contact.data}
            loading={contact.isLoading}
            error={contact.isError ? (contact.error as Error).message : null}
            saving={saveContact.isPending}
            clientLink={contactClientLink.data?.link || null}
            clientLinkLoading={contactClientLink.isLoading}
            onClose={() => setContactOpen(false)}
            onSave={(payload) => saveContact.mutate(payload)}
            onLinked={() => {
              qc.invalidateQueries({ queryKey: ["hd-contact-client-link", contactId] });
            }}
          />
        ) : null}
      </div>

      {transferOpen && current ? (
        <TransferDialog
          conversation={current}
          queues={queues.data || []}
          assignees={assignees.data || []}
          pending={transfer.isPending}
          error={transfer.error ? (transfer.error as Error).message : null}
          onClose={() => setTransferOpen(false)}
          onSubmit={(payload) => transfer.mutate(payload)}
        />
      ) : null}

      <NewConversationDialog
        open={newConversationOpen}
        queues={queues.data || []}
        connections={connections.data || []}
        onClose={() => setNewConversationOpen(false)}
        onStarted={(conversation) => {
          setNewConversationOpen(false);
          setTab("open");
          setMineOnly(false);
          setActiveId(conversation.id);
          setError(null);
          setContactOpen(false);
          qc.invalidateQueries({ queryKey: ["hd-list"] });
          qc.invalidateQueries({ queryKey: ["hd-overview"] });
          qc.invalidateQueries({ queryKey: ["hd-list-counts"] });
          qc.setQueryData(["hd-conversation", conversation.id], conversation);
        }}
      />

      <TicketCreateDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setTicketDefaults(null);
        }}
        defaults={
          ticketDefaults ||
          ticketDefaultsFromConversation(current, contactClientLink.data?.link || null)
        }
        onCreated={(created) => {
          setAiResult(null);
          setTicketDefaults(null);
          if (!current?.id || !created?.id) return;
          const conversationId = current.id;
          const ticketId = created.id;
          if (linkedTicketId) {
            setError("Esta conversa já possui um chamado ativo.");
            return;
          }
          justLinkedTicketId.current = ticketId;
          setLinkedFallback({ conversationId, ticketId });
          applyLinkedTicketId(qc, conversationId, ticketId);
          helpdesk
            .linkTicket(conversationId, ticketId)
            .then((res) => {
              const confirmedId = res?.computicket_ticket_id || ticketId;
              justLinkedTicketId.current = confirmedId;
              setLinkedFallback({ conversationId, ticketId: confirmedId });
              applyLinkedTicketId(qc, conversationId, confirmedId);
              qc.invalidateQueries({ queryKey: ["hd-conversation", conversationId] });
              qc.invalidateQueries({ queryKey: ["hd-messages", conversationId] });
            })
            .catch((e: Error) => {
              justLinkedTicketId.current = null;
              setLinkedFallback((prev) =>
                prev?.conversationId === conversationId && prev.ticketId === ticketId ? null : prev,
              );
              qc.invalidateQueries({ queryKey: ["hd-conversation", conversationId] });
              setError(e.message || "Não foi possível vincular o chamado.");
            });
        }}
      />

      <Modal open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} title="Consultar conhecimento">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void askKnowledge();
          }}
        >
          <p className="text-sm text-muted">
            Faça uma pergunta ao banco de conhecimento. A resposta será exibida como rascunho antes de ir para o campo de mensagem.
          </p>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Pergunta</span>
            <textarea
              autoFocus
              value={knowledgeQuestion}
              onChange={(e) => setKnowledgeQuestion(e.target.value)}
              rows={4}
              className="mt-1 w-full resize-y rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
              placeholder="Ex.: Como orientar o cliente sobre este problema?"
            />
          </label>
          {aiError ? <p className="text-sm text-open">{aiError}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setKnowledgeOpen(false)} className="rounded-lg px-3 py-2 text-sm text-muted">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={aiAction !== null || !knowledgeQuestion.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {aiAction === "query" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {aiAction === "query" ? "Consultando…" : "Consultar"}
            </button>
          </div>
        </form>
      </Modal>

      {historyViewId ? (
        <HistoryMessagesModal conversationId={historyViewId} onClose={() => setHistoryViewId(null)} />
      ) : null}

      {linkedTicket && entryMode ? (
        <TimeEntryDialog
          open
          ticketId={linkedTicket.id}
          mode={entryMode}
          onSaved={() => {
            entryContinueRef.current = true;
            const ticketId = linkedTicket.id;
            void flask
              .get<TicketDetail>(`/tickets/api/${ticketId}`)
              .then((ticket) => {
                setLinkedTicket(ticket);
                setCloseTicketOpen(true);
              })
              .catch((e) => {
                abortTicketCloseFlow();
                setError(e instanceof Error ? e.message : "Erro ao recarregar chamado");
              });
          }}
          onClose={() => {
            setEntryMode(null);
            if (entryContinueRef.current) {
              entryContinueRef.current = false;
              return;
            }
            abortTicketCloseFlow();
          }}
        />
      ) : null}

      {linkedTicket && closeTicketOpen ? (
        <CloseTicketDialog
          open
          ticket={linkedTicket}
          onClosed={onLinkedTicketClosed}
          onClose={() => {
            setCloseTicketOpen(false);
            setLinkedTicket(null);
            pendingResolveChatId.current = null;
          }}
        />
      ) : null}
    </div>
  );
}

function AiMenuItem({
  label,
  pending,
  disabled,
  icon,
  onClick,
}: {
  label: string;
  pending: boolean;
  disabled: boolean;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-wash disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? (
        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        icon || <WandSparkles className="h-3.5 w-3.5 shrink-0" />
      )}
      {label}
    </button>
  );
}

function sourceHref(source: HelpdeskAiSource) {
  const explicit = source.href || source.url;
  if (explicit?.startsWith("/conhecimento") || explicit?.startsWith("/tickets")) return explicit;

  const ticketId =
    source.ticket_id ||
    source.metadata?.ticket_id ||
    (source.source_type === "ticket" ? source.source_id : undefined);
  if (ticketId) return `/tickets/${ticketId}`;

  const categoryId =
    source.category_id ||
    source.metadata?.category_id ||
    source.knowledge_id ||
    source.metadata?.knowledge_id;
  if (categoryId) return `/conhecimento/${categoryId}`;
  return null;
}

function AiSources({ sources }: { sources: HelpdeskAiSource[] }) {
  return (
    <div className="mt-3 border-t border-line pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Fontes</p>
      {sources.length ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {sources.map((source, index) => {
            const href = sourceHref(source);
            const label =
              source.title ||
              source.name ||
              source.metadata?.title ||
              (source.ticket_id || source.metadata?.ticket_id || source.source_type === "ticket"
                ? `Chamado #${source.ticket_id || source.metadata?.ticket_id || source.source_id}`
                : `Evidência ${index + 1}`);
            return href ? (
              <Link
                key={`${href}-${index}`}
                href={href}
                target="_blank"
                className="rounded-full bg-progress-bg px-2 py-1 text-[11px] font-medium text-brand hover:underline"
              >
                {label}
              </Link>
            ) : (
              <span key={`${label}-${index}`} className="rounded-full bg-wash px-2 py-1 text-[11px] text-muted">
                {label}
              </span>
            );
          })}
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted">Sem evidências encontradas para este rascunho.</p>
      )}
    </div>
  );
}

function AiDraftPanel({
  result,
  onDraftChange,
  onApplyText,
  onApplyTicket,
  onClose,
}: {
  result: AiResult;
  onDraftChange: (draft: string) => void;
  onApplyText: () => void;
  onApplyTicket: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mb-2 rounded-xl border border-progress/30 bg-surface p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-navy">
          <Bot className="h-4 w-4 text-brand" />
          {result.title}
        </p>
        <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Descartar rascunho">
          <X className="h-4 w-4" />
        </button>
      </div>
      {result.kind === "text" ? (
        <>
          <textarea
            value={result.draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={4}
            className="mt-2 max-h-40 w-full resize-y rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
            aria-label="Rascunho do copiloto"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!result.draft.trim()}
              onClick={onApplyText}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              Usar no campo de mensagem
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mt-2 rounded-lg bg-wash p-3 text-xs text-ink">
            <p className="font-semibold">{result.ticket.title || "Chamado sem título"}</p>
            <p className="mt-1 whitespace-pre-wrap text-muted">{result.ticket.description || "Sem descrição"}</p>
            {result.ticket.solicitante ? <p className="mt-2 text-muted">Solicitante: {result.ticket.solicitante}</p> : null}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onApplyTicket}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white"
            >
              Revisar no formulário
            </button>
          </div>
        </>
      )}
      <AiSources sources={result.sources} />
      <p className="mt-2 text-[10px] text-muted">Conteúdo gerado por IA. Revise antes de usar.</p>
    </div>
  );
}

function NewConversationDialog({
  open,
  queues,
  connections,
  onClose,
  onStarted,
}: {
  open: boolean;
  queues: HelpdeskQueue[];
  connections: { id: number; name: string; status?: string }[];
  onClose: () => void;
  onStarted: (conversation: HelpdeskConversation) => void;
}) {
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const [contactSearch, setContactSearch] = useState("");
  const [debouncedContactSearch, setDebouncedContactSearch] = useState("");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [queueId, setQueueId] = useState("");
  const [whatsappId, setWhatsappId] = useState("");
  const [busyId, setBusyId] = useState<number | "create" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode("pick");
    setContactSearch("");
    setDebouncedContactSearch("");
    setName("");
    setNumber("");
    setQueueId("");
    setWhatsappId(() => {
      const connected = connections.find((c) => (c.status || "").toLowerCase() === "connected");
      return String((connected || connections[0])?.id || "");
    });
    setBusyId(null);
    setLocalError(null);
  }, [open, connections]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedContactSearch(contactSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [contactSearch]);

  const contacts = useQuery({
    queryKey: ["hd-contacts", debouncedContactSearch],
    queryFn: () => helpdesk.contacts({ search: debouncedContactSearch || undefined }),
    enabled: open && mode === "pick",
  });

  async function startWithContact(contact: HelpdeskContact) {
    if (!contact.id) return;
    setBusyId(contact.id);
    setLocalError(null);
    try {
      const conversation = await helpdesk.startConversation({
        contactId: contact.id,
        ...(queueId ? { queueId: Number(queueId) } : {}),
        ...(whatsappId ? { whatsappId: Number(whatsappId) } : {}),
      });
      onStarted(conversation);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Não foi possível iniciar a conversa");
    } finally {
      setBusyId(null);
    }
  }

  async function createAndStart() {
    const trimmedName = name.trim();
    const digits = number.replace(/\D/g, "");
    if (!trimmedName) {
      setLocalError("Informe o nome do contato");
      return;
    }
    if (digits.length < 8) {
      setLocalError("Informe um telefone/WhatsApp válido");
      return;
    }
    setBusyId("create");
    setLocalError(null);
    try {
      const contact = await helpdesk.createContact({ name: trimmedName, number: digits });
      if (!contact.id) throw new Error("Contato criado sem id");
      const conversation = await helpdesk.startConversation({
        contactId: contact.id,
        ...(queueId ? { queueId: Number(queueId) } : {}),
        ...(whatsappId ? { whatsappId: Number(whatsappId) } : {}),
      });
      onStarted(conversation);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Não foi possível criar a conversa");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nova conversa" wide>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Escolha um contato existente ou cadastre um número novo para abrir o atendimento no WhatsApp.
        </p>

        <div className="flex rounded-lg border border-line bg-wash p-0.5">
          <button
            type="button"
            onClick={() => {
              setMode("pick");
              setLocalError(null);
            }}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide",
              mode === "pick" ? "bg-surface text-navy shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            Contatos
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("create");
              setLocalError(null);
            }}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide",
              mode === "create" ? "bg-surface text-navy shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            Novo contato
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Conexão</span>
            <select
              value={whatsappId}
              onChange={(e) => setWhatsappId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px]"
            >
              <option value="">Padrão do agente</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {(c.status || "").toLowerCase() === "connected" ? "" : c.status ? ` (${c.status})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Fila</span>
            <select
              value={queueId}
              onChange={(e) => setQueueId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px]"
            >
              <option value="">Sem fila</option>
              {queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {mode === "pick" ? (
          <div className="space-y-3">
            <label className="flex items-center gap-2 rounded-lg border border-line bg-wash px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted" />
              <input
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Buscar por nome ou número"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
                autoFocus
              />
            </label>
            <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-lg border border-line">
              {contacts.isLoading ? (
                <p className="px-3 py-8 text-center text-sm text-muted">Carregando contatos…</p>
              ) : contacts.isError ? (
                <p className="px-3 py-8 text-center text-sm text-open">
                  {(contacts.error as Error).message || "Falha ao listar contatos"}
                </p>
              ) : (contacts.data?.contacts || []).length === 0 ? (
                <div className="px-3 py-8 text-center">
                  <p className="text-sm text-muted">Nenhum contato encontrado</p>
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-brand hover:underline"
                    onClick={() => setMode("create")}
                  >
                    Criar novo contato
                  </button>
                </div>
              ) : (
                (contacts.data?.contacts || []).map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    disabled={busyId != null}
                    onClick={() => startWithContact(contact)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-wash disabled:opacity-60"
                  >
                    <UserAvatar
                      name={contact.name || contact.number || "?"}
                      src={publicMediaUrl(contact.profilePicUrl)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {contact.name || "Sem nome"}
                      </span>
                      <span className="block truncate text-xs text-muted">{contact.number || "—"}</span>
                    </span>
                    {busyId === contact.id ? (
                      <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-brand" />
                    ) : (
                      <MessageSquarePlus className="h-4 w-4 shrink-0 text-muted" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void createAndStart();
            }}
          >
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Nome</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] outline-none"
                placeholder="Nome do contato"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                Telefone / WhatsApp
              </span>
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px] outline-none"
                placeholder="5511999999999"
                inputMode="tel"
              />
              <span className="mt-1 block text-[11px] text-muted">
                Prefira DDI + DDD + número. O engine valida se o número existe no WhatsApp.
              </span>
            </label>
            <button
              type="submit"
              disabled={busyId != null}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
            >
              {busyId === "create" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Criar e iniciar conversa
            </button>
          </form>
        )}

        {localError ? <p className="text-sm text-open">{localError}</p> : null}
      </div>
    </Modal>
  );
}

function TransferDialog({
  conversation,
  queues,
  assignees,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  conversation: HelpdeskConversation;
  queues: { id: number; name: string; color?: string }[];
  assignees: { name: string; engine_user_id: number }[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: TransferPayload) => void;
}) {
  const [userId, setUserId] = useState<string>(conversation.userId ? String(conversation.userId) : "");
  const [queueId, setQueueId] = useState<string>(conversation.queueId ? String(conversation.queueId) : "");

  return (
    <Modal open onClose={onClose} title="Transferir">
        <p className="-mt-2 text-sm text-muted">Mova a conversa para outro agente e/ou outra fila.</p>
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const payload: TransferPayload = {};
            if (userId) payload.userId = Number(userId);
            if (queueId) payload.queueId = Number(queueId);
            if (!payload.userId && !payload.queueId) return;
            onSubmit(payload);
          }}
        >
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Agente</span>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px]"
            >
              <option value="">Manter / não atribuir</option>
              {assignees.map((a) => (
                <option key={a.engine_user_id} value={a.engine_user_id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Fila</span>
            <select
              value={queueId}
              onChange={(e) => setQueueId(e.target.value)}
              className="mt-1 w-full border-0 border-b border-line bg-transparent py-2 text-[15px]"
            >
              <option value="">Manter fila atual</option>
              {queues.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="text-sm text-open">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || (!userId && !queueId)}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {pending ? "Transferindo…" : "Transferir"}
            </button>
          </div>
        </form>
    </Modal>
  );
}

function ConversationHistoryStrip({
  items,
  onOpen,
}: {
  items: HelpdeskConversationHistoryItem[];
  onOpen: (id: number) => void;
}) {
  return (
    <div className="shrink-0 border-b border-chat-border bg-wash px-4 py-2">
      <p className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        <History className="h-3 w-3" />
        Histórico
      </p>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.id)}
            className="min-w-[11rem] max-w-[14rem] shrink-0 rounded-lg border border-chat-border bg-surface px-2.5 py-1.5 text-left hover:border-brand/40"
            title="Ver mensagens deste ciclo"
          >
            <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-ink">
              <span>#{item.id}</span>
              <span className="font-normal text-muted">{formatDay(item.updatedAt)}</span>
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted">
              {snippet(item.lastMessage) || "Sem última mensagem"}
            </span>
            <span className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
              {item.computicket_ticket_id ? <span>Chamado #{item.computicket_ticket_id}</span> : null}
              {item.rating?.answered && item.rating.score != null ? (
                <span className="inline-flex items-center gap-0.5">
                  <Star className="h-3 w-3 fill-[#f6b91a] text-[#f6b91a]" />
                  {item.rating.score}/5
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HistoryMessagesModal({
  conversationId,
  onClose,
}: {
  conversationId: number;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["hd-messages", "history", conversationId],
    queryFn: () => helpdesk.messages(conversationId),
  });
  const items = unwrapMessages(query.data);

  return (
    <Modal open onClose={onClose} title={`Histórico · conversa #${conversationId}`}>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
        {query.isLoading ? <p className="text-sm text-muted">Carregando mensagens…</p> : null}
        {query.isError ? (
          <p className="text-sm text-open">Não foi possível carregar este ciclo.</p>
        ) : null}
        {query.isSuccess && items.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma mensagem neste ciclo.</p>
        ) : null}
        {items.map((m, idx) => {
          const system = m.isInternal || m.isPrivate;
          const mine = !!m.fromMe && !system;
          const audio = !!(m.mediaUrl && mediaKind(m.mediaType, m.mediaUrl) === "audio");
          return (
            <div
              key={`${m.id}-${idx}`}
              className={cn("flex", system ? "justify-center" : mine ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-1.5 text-sm",
                  audio && "w-[min(18rem,80%)]",
                  system
                    ? "bg-note text-center text-xs text-note-fg"
                    : mine
                      ? "bg-bubble-out text-ink"
                      : "bg-wash text-ink",
                )}
              >
                {m.mediaUrl ? <ThreadMedia mediaUrl={m.mediaUrl} mediaType={m.mediaType} /> : null}
                {audio ? <AudioTranscript message={m} conversationId={conversationId} /> : null}
                {m.body && !(audio && isPlaceholderAudioBody(m.body)) ? (
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                ) : null}
                <p className="mt-0.5 text-right text-[10px] text-muted">
                  {formatDay(m.createdAt)} {formatClock(m.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function ContactDrawer({
  conversation,
  detail,
  loading,
  error,
  saving,
  clientLink,
  clientLinkLoading,
  onClose,
  onSave,
  onLinked,
}: {
  conversation: HelpdeskConversation;
  detail?: {
    name?: string;
    number?: string;
    email?: string;
    profilePicUrl?: string | null;
    extraInfo?: { name?: string; value?: string }[];
  };
  loading: boolean;
  error: string | null;
  saving: boolean;
  clientLink: HelpdeskContactClientLink | null;
  clientLinkLoading: boolean;
  onClose: () => void;
  onSave: (payload: { name: string; email: string; notes: string }) => void;
  onLinked: () => void;
}) {
  const [name, setName] = useState(detail?.name || conversation.contact?.name || "");
  const [email, setEmail] = useState(detail?.email || conversation.contact?.email || "");
  const [notes, setNotes] = useState(
    detail?.extraInfo?.find((e) => (e.name || "").toLowerCase() === "observações")?.value || "",
  );
  const [clientQ, setClientQ] = useState("");
  const [debouncedClientQ, setDebouncedClientQ] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const photo =
    publicMediaUrl(detail?.profilePicUrl) || publicMediaUrl(conversation.contact?.profilePicUrl);

  const clients = useQuery({
    queryKey: ["clients", "hd-contact-link", debouncedClientQ],
    queryFn: () =>
      flask.get<{ items: { id: number; name: string; document?: string; phone?: string }[] }>(
        `/api/web/clients?q=${encodeURIComponent(debouncedClientQ)}&per_page=30`,
      ),
    enabled: !clientLink && debouncedClientQ.length >= 1,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedClientQ(clientQ.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [clientQ]);

  useEffect(() => {
    if (!detail) return;
    setName(detail.name || conversation.contact?.name || "");
    setEmail(detail.email || "");
    setNotes(detail.extraInfo?.find((e) => (e.name || "").toLowerCase() === "observações")?.value || "");
  }, [detail, conversation.contact?.name]);

  useEffect(() => {
    setClientQ("");
    setDebouncedClientQ("");
    setLinkError(null);
  }, [conversation.contact?.id, clientLink?.id]);

  async function linkClient(chosen: { id: number; name: string }) {
    const contactId = conversation.contact?.id;
    if (!contactId) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      await helpdesk.upsertContactClientLink(contactId, {
        external_client_id: chosen.id,
        external_client_name: chosen.name,
        contact_number: detail?.number || conversation.contact?.number || undefined,
      });
      setClientQ("");
      setDebouncedClientQ("");
      onLinked();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Falha ao vincular cliente");
    } finally {
      setLinkBusy(false);
    }
  }

  async function unlinkClient() {
    const contactId = conversation.contact?.id;
    if (!contactId || !clientLink) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      await helpdesk.deleteContactClientLink(contactId);
      onLinked();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Falha ao desvincular cliente");
    } finally {
      setLinkBusy(false);
    }
  }

  return (
    <aside className="flex min-h-0 w-[320px] shrink-0 flex-col overflow-hidden border-l border-line bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-navy">
          <UserRound className="h-4 w-4" />
          Contato
        </p>
        <button type="button" onClick={onClose} className="text-xs text-muted hover:text-ink">
          Fechar
        </button>
      </div>
      <form
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name: name.trim(), email: email.trim(), notes });
        }}
      >
        <div className="flex flex-col items-center gap-2 py-2">
          <UserAvatar
            name={name || conversation.contact?.name || conversation.contact?.number}
            src={photo}
            size="xl"
          />
          <p className="text-center text-sm font-semibold text-ink">
            {name || conversation.contact?.name || "Contato"}
          </p>
          <p className="text-center text-xs text-muted">
            {detail?.number || conversation.contact?.number || "—"}
          </p>
        </div>
        {loading ? <p className="text-sm text-muted">Carregando dados…</p> : null}
        {error ? (
          <p className="text-xs text-open">
            {/^Erro 50[234]$/i.test(error) || /indispon/i.test(error)
              ? "Não foi possível carregar o contato (engine WhatsApp indisponível). Você ainda pode editar e salvar com os dados da conversa."
              : error}
          </p>
        ) : null}
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Nome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full border-0 border-b border-line py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">E-mail</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full border-0 border-b border-line py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Observações</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            className="mt-1 w-full resize-y border-0 border-b border-line py-2 text-sm"
          />
        </label>

        <div className="space-y-2 border-t border-line pt-4">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
            Cliente do Uniplus
          </span>
          {clientLinkLoading ? (
            <p className="text-sm text-muted">Carregando vínculo…</p>
          ) : clientLink ? (
            <div className="space-y-2">
              <p className="text-sm text-ink">{clientLink.external_client_name}</p>
              <p className="text-xs text-muted">ID #{clientLink.external_client_id}</p>
              <button
                type="button"
                disabled={linkBusy || !conversation.contact?.id}
                onClick={() => void unlinkClient()}
                className="text-xs font-medium text-open hover:underline disabled:opacity-40"
              >
                {linkBusy ? "Desvinculando…" : "Desvincular cliente"}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block">
                <span className="sr-only">Buscar cliente</span>
                <input
                  value={clientQ}
                  onChange={(e) => setClientQ(e.target.value)}
                  placeholder="Digite nome, documento ou telefone…"
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </label>
              {!clientQ.trim() ? (
                <p className="text-xs text-muted">Digite para pesquisar diretamente nos clientes do Uniplus.</p>
              ) : clients.isFetching || clientQ.trim() !== debouncedClientQ ? (
                <p className="flex items-center gap-2 py-2 text-xs text-muted">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  Buscando no Uniplus…
                </p>
              ) : clients.error ? (
                <p className="text-xs text-open">{(clients.error as Error).message}</p>
              ) : (clients.data?.items || []).length ? (
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface p-1">
                  {(clients.data?.items || []).map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      disabled={linkBusy || !conversation.contact?.id}
                      onClick={() => void linkClient(client)}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left hover:bg-wash disabled:opacity-40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{client.name}</span>
                        {client.document || client.phone ? (
                          <span className="block truncate text-[11px] text-muted">
                            {[client.document, client.phone].filter(Boolean).join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[11px] font-semibold text-brand">
                        {linkBusy ? "Aguarde…" : "Vincular"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-xs text-muted">Nenhum cliente encontrado no Uniplus.</p>
              )}
            </div>
          )}
          {linkError ? <p className="text-xs text-open">{linkError}</p> : null}
        </div>

        <button
          type="submit"
          disabled={saving || !conversation.contact?.id}
          className="mt-auto rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? "Salvando…" : "Salvar contato"}
        </button>
      </form>
    </aside>
  );
}
