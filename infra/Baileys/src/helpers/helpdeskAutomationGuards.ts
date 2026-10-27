const normalizeBody = (body: string | null | undefined): string =>
  String(body || "")
    .trim()
    .toLowerCase()
    .replace(/\u200e/g, "")
    .replace(/\u200c/g, "")
    .trim();

/** Ausente no banco significa ligado, para não mudar o comportamento até alguém desligar. */
export const isFeatureEnabled = (value: string | null | undefined): boolean => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return true;
  return raw !== "disabled";
};

export const isAutomatedHelpdeskBody = (
  body: string | null | undefined
): boolean => {
  const raw = String(body || "");
  if (/^\u200c/.test(raw) || raw.startsWith("\u200e")) return true;
  const norm = normalizeBody(raw);
  if (!norm) return false;
  if (norm.includes("escolha o setor")) return true;
  return /\*\[\s*\d+\s*\]\*/.test(raw) || /\[\s*\d+\s*\]\s*-/.test(norm);
};

export const sectorMenuAlreadyShown = (ticket: {
  lastGreetingSentAt?: Date | null;
  flowStopped?: string | null;
  lastFlowId?: string | null;
}): boolean =>
  !!(ticket.lastGreetingSentAt || ticket.flowStopped || ticket.lastFlowId);

export const shouldStartSectorAutomation = (input: {
  sectorMenuEnabled: boolean;
  requestedMenu: boolean;
  alreadyShown: boolean;
}): boolean => {
  if (!input.sectorMenuEnabled) return false;
  if (input.requestedMenu) return true;
  return !input.alreadyShown;
};

/** Texto livre não reenvia o menu; # pede de novo. */
export const shouldSuppressRepeatedMenu = (input: {
  requestedMenu: boolean;
  amountUsedBotQueues: number;
  maxUseBotQueues: number;
  chatbotAt: Date | null;
  now: Date;
  timeUseBotQueuesMinutes: number;
}): boolean => {
  if (input.requestedMenu) return false;
  const max = Number(input.maxUseBotQueues) || 0;
  const used = Number(input.amountUsedBotQueues) || 0;
  if (max > 0 && used >= max) return true;
  const windowMin = Number(input.timeUseBotQueuesMinutes) || 0;
  if (input.chatbotAt && windowMin > 0 && used !== 0) {
    const limit = new Date(input.chatbotAt);
    limit.setMinutes(limit.getMinutes() + windowMin);
    if (input.now < limit) return true;
  }
  return false;
};

export const isWaitingForSector = (ticket: {
  queueId?: number | null;
  userId?: number | null;
}): boolean => !ticket.queueId && !ticket.userId;

export const isBotFlowTicket = (ticket: {
  chatbot?: boolean | null;
  flowWebhook?: boolean | null;
  useIntegration?: boolean | null;
}): boolean => !!(ticket.chatbot || ticket.flowWebhook || ticket.useIntegration);

export const shouldCloseForConnectionExpiry = (input: {
  status?: string | null;
  isGroup?: boolean | null;
  fromMe?: boolean | null;
  queueId?: number | null;
  userId?: number | null;
  chatbot?: boolean | null;
  flowWebhook?: boolean | null;
  useIntegration?: boolean | null;
  updatedAt: Date;
  expiresTicketHours: number;
  now: Date;
}): boolean => {
  const hours = Number(input.expiresTicketHours);
  if (!Number.isFinite(hours) || hours <= 0) return false;
  if (input.status !== "open" || input.isGroup) return false;
  if (!input.fromMe) return false;
  if (isWaitingForSector(input) || isBotFlowTicket(input)) return false;
  const limit = new Date(input.now.getTime() - hours * 60 * 60 * 1000);
  return input.updatedAt < limit;
};

export type AutoCloseCache = {
  anchor: string;
  warned: boolean;
  warningBody?: string;
};

export type AutoCloseAction =
  | { type: "skip"; clearCache?: boolean }
  | { type: "wait"; clearCache?: boolean }
  | { type: "warn"; anchor: Date; remainingMinutes: number }
  | { type: "close" };

const sameText = (a?: string | null, b?: string | null): boolean =>
  normalizeBody(a) === normalizeBody(b);

export const decideCompanyAutoClose = (input: {
  autoCloseEnabled: boolean;
  queueId?: number | null;
  userId?: number | null;
  chatbot?: boolean | null;
  flowWebhook?: boolean | null;
  useIntegration?: boolean | null;
  lastMessage?: string | null;
  updatedAt: Date;
  now: number;
  warnAfterMs: number;
  closeAfterMs: number;
  cached: AutoCloseCache | null;
}): AutoCloseAction => {
  if (!input.autoCloseEnabled) return { type: "skip" };
  if (isWaitingForSector(input) || isBotFlowTicket(input)) return { type: "skip" };

  const warned =
    !!input.cached?.warned &&
    !!input.cached.warningBody &&
    sameText(input.lastMessage, input.cached.warningBody);

  if (!warned && isAutomatedHelpdeskBody(input.lastMessage)) {
    return { type: "skip", clearCache: !!input.cached };
  }

  const anchor =
    warned && input.cached?.anchor
      ? new Date(input.cached.anchor)
      : input.updatedAt;
  const idleMs = input.now - anchor.getTime();

  if (idleMs < input.warnAfterMs) {
    return {
      type: "wait",
      clearCache: !!(input.cached && input.cached.anchor !== anchor.toISOString())
    };
  }
  if (idleMs >= input.closeAfterMs) return { type: "close" };

  if (warned && input.cached?.anchor === anchor.toISOString()) {
    return { type: "wait" };
  }

  return {
    type: "warn",
    anchor,
    remainingMinutes: Math.max(1, Math.ceil((input.closeAfterMs - idleMs) / 60_000))
  };
};
