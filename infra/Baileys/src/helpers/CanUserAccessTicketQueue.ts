import User from "../models/User";
import Ticket from "../models/Ticket";

const normalizeId = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/** Verifica se o usuário pode acessar o ticket pela fila, atribuição ou allTicket. */
export const canUserAccessTicket = (
  ticket: Pick<Ticket, "userId" | "queueId" | "isGroup">,
  user: Pick<User, "id" | "profile" | "allTicket"> & { queues?: { id: number }[] }
): boolean => {
  if (!user?.id) return false;
  if (user.profile === "admin") return true;

  // Grupos WhatsApp não usam fila; ficam visíveis para atendentes da empresa
  if (ticket.isGroup) {
    return true;
  }

  const ticketUserId = normalizeId(ticket.userId);
  const userId = normalizeId(user.id);
  if (ticketUserId !== null && ticketUserId === userId) {
    return true;
  }

  const ticketQueueId = normalizeId(ticket.queueId);
  if (ticketQueueId === null) {
    return user.allTicket === "enabled";
  }

  const userQueueIds = (user.queues || [])
    .map((q) => normalizeId(q.id))
    .filter((id): id is number => id !== null);

  return userQueueIds.includes(ticketQueueId);
};

/** Pode enviar mensagem (ticket aberto + atribuído ou aberto na fila do usuário). */
export const canUserSendOnTicket = (
  ticket: Pick<Ticket, "userId" | "queueId" | "status" | "isGroup">,
  user: Pick<User, "id" | "profile" | "allTicket"> & { queues?: { id: number }[] }
): boolean => {
  if (!user?.id) return false;
  if (ticket.status !== "open") return false;
  if (user.profile === "admin") return true;

  if (ticket.isGroup) {
    return canUserAccessTicket(ticket, user);
  }

  const ticketUserId = normalizeId(ticket.userId);
  const userId = normalizeId(user.id);
  if (ticketUserId !== null) {
    return ticketUserId === userId;
  }

  return canUserAccessTicket(ticket, user);
};

export default canUserAccessTicket;
