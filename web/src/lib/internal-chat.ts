import { flask } from "@/lib/api";

export type InternalChatTab = "dm" | "group";

export type InternalChatParticipant = {
  id?: number | null;
  name?: string;
  avatar?: string | null;
};

export type InternalChat = {
  id: number;
  uuid?: string;
  title: string;
  lastMessage?: string;
  isGroup: boolean;
  ownerId?: number | null;
  owner?: InternalChatParticipant | null;
  unreads?: number;
  peer?: InternalChatParticipant | null;
  participants?: InternalChatParticipant[];
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type InternalChatMessage = {
  id: number;
  chatId?: number;
  senderId?: number | null;
  sender?: InternalChatParticipant | null;
  message?: string;
  mediaPath?: string | null;
  mediaName?: string | null;
  mediaUrl?: string | null;
  mine?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type InternalChatColleague = {
  id: number;
  name: string;
  email?: string;
  role?: string;
  engine_user_id: number;
};

export type InternalChatListRes = {
  records: InternalChat[];
  count?: number;
  hasMore?: boolean;
  engineUserId?: number;
};

export type InternalChatMessageListRes = {
  records: InternalChatMessage[];
  count?: number;
  hasMore?: boolean;
};

export type InternalChatHealth = {
  ok: boolean;
  error?: string;
  engine?: { ok?: boolean };
  companyId?: number;
  engineUserId?: number;
};

export const INTERNAL_CHAT_MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export function internalChatMediaSizeError(file: File): string | null {
  if (file.size <= INTERNAL_CHAT_MAX_MEDIA_BYTES) return null;
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  return `Arquivo muito grande (${mb} MB). O chat interno aceita no máximo 10 MB.`;
}

export function isPlaceholderName(name?: string | null) {
  const raw = (name || "").trim();
  return !raw || raw.toLowerCase() === "colaborador" || raw.toLowerCase() === "conversa";
}

export function chatDisplayName(chat?: InternalChat | null): string {
  if (!chat) return "Conversa";
  if (!chat.isGroup) {
    const peer = chat.peer?.name?.trim();
    if (peer && !isPlaceholderName(peer)) return peer;
  }
  const title = chat.title?.trim();
  if (title && !isPlaceholderName(title)) return title;
  return "Conversa";
}

export function mergeParticipant(
  prev?: InternalChatParticipant | null,
  incoming?: InternalChatParticipant | null,
): InternalChatParticipant | null | undefined {
  if (!incoming) return prev;
  if (!prev) return incoming;
  return {
    ...prev,
    ...incoming,
    name: isPlaceholderName(incoming.name) ? prev.name : incoming.name,
    avatar: incoming.avatar || prev.avatar,
  };
}

export function mergeInternalChat(prev: InternalChat, incoming: Partial<InternalChat>): InternalChat {
  const peer = mergeParticipant(prev.peer, incoming.peer);
  const incomingTitle = incoming.title;
  const title =
    incomingTitle && !isPlaceholderName(incomingTitle)
      ? incomingTitle
      : peer?.name && !isPlaceholderName(peer.name)
        ? peer.name
        : prev.title;
  const incomingParticipants = incoming.participants;
  const participants =
    incomingParticipants && incomingParticipants.some((p) => p.name && !isPlaceholderName(p.name))
      ? incomingParticipants.map((p) => {
          const old = (prev.participants || []).find((row) => row.id != null && row.id === p.id);
          return mergeParticipant(old, p) || p;
        })
      : incomingParticipants || prev.participants;
  return {
    ...prev,
    ...incoming,
    title,
    peer,
    participants,
    owner: mergeParticipant(prev.owner, incoming.owner) || incoming.owner || prev.owner,
    unreads: incoming.unreads ?? prev.unreads,
  };
}

export function publicInternalMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw || /nopicture/i.test(raw)) return null;
  if (raw.includes("/internal-chat/api/media/") || raw.includes("/helpdesk/api/media/")) {
    const idx = raw.includes("/internal-chat/api/media/")
      ? raw.indexOf("/internal-chat/api/media/")
      : raw.indexOf("/helpdesk/api/media/");
    return raw.startsWith("/flask") ? raw : `/flask${raw.slice(idx)}`;
  }
  const publicIdx = raw.indexOf("/public/");
  if (publicIdx >= 0) {
    const path = raw.slice(publicIdx + "/public/".length).split(/[?#]/)[0];
    if (!path || path.split("/").includes("..")) return null;
    return `/flask/internal-chat/api/media/${path}`;
  }
  if (raw.startsWith("chat-media/") || raw.startsWith("avatars/")) {
    return `/flask/internal-chat/api/media/${raw.split(/[?#]/)[0]}`;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw;
}

export const internalChat = {
  health: () => flask.get<InternalChatHealth>("/internal-chat/api/health"),
  navBadge: () => flask.get<{ count: number }>("/internal-chat/api/nav-badge"),
  colleagues: () => flask.get<{ items: InternalChatColleague[] }>("/internal-chat/api/colleagues"),
  chats: (opts?: { isGroup?: boolean; pageNumber?: string }) => {
    const q = new URLSearchParams({ pageNumber: opts?.pageNumber || "1", pageSize: "50" });
    if (opts?.isGroup === true) q.set("isGroup", "true");
    if (opts?.isGroup === false) q.set("isGroup", "false");
    return flask.get<InternalChatListRes>(`/internal-chat/api/chats?${q}`);
  },
  messages: (id: number, page = "1") =>
    flask.get<InternalChatMessageListRes>(`/internal-chat/api/chats/${id}/messages?pageNumber=${page}`),
  send: (id: number, message: string) =>
    flask.post<InternalChatMessage>(`/internal-chat/api/chats/${id}/messages`, { message }),
  sendMedia: (id: number, file: File, message = "") => {
    const form = new FormData();
    form.append("media", file);
    form.append("message", message);
    return flask.post<InternalChatMessage>(`/internal-chat/api/chats/${id}/messages`, form);
  },
  read: (id: number) => flask.post<InternalChat>(`/internal-chat/api/chats/${id}/read`),
  createGroup: (title: string, userIds: number[]) =>
    flask.post<InternalChat>("/internal-chat/api/chats", { title, users: userIds.map((id) => ({ id })) }),
  updateGroup: (id: number, payload: { title?: string; userIds?: number[] }) =>
    flask.put<InternalChat>(`/internal-chat/api/chats/${id}`, {
      title: payload.title,
      users: payload.userIds?.map((userId) => ({ id: userId })),
    }),
  remove: (id: number) => flask.delete<{ ok: boolean; id: number }>(`/internal-chat/api/chats/${id}`),
};
