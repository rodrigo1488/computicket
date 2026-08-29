import { proto } from "baileys";

/** Converte messageTimestamp do Baileys (Long ou number, em segundos) para Date. */
export const getMessageCreatedAt = (
  msg: proto.IWebMessageInfo
): Date => {
  const ts = msg.messageTimestamp;
  if (ts == null) {
    return new Date();
  }

  let seconds: number;
  if (typeof ts === "object" && typeof (ts as { toNumber?: () => number }).toNumber === "function") {
    seconds = (ts as { toNumber: () => number }).toNumber();
  } else {
    seconds = Number(ts);
  }

  if (!seconds || Number.isNaN(seconds)) {
    return new Date();
  }

  return new Date(Math.floor(seconds * 1000));
};

/** Ordenacao de batch messages.upsert pelo timestamp do WhatsApp. */
export const getMessageTimestampSeconds = (
  msg: proto.IWebMessageInfo
): number => {
  const createdAt = getMessageCreatedAt(msg);
  return Math.floor(createdAt.getTime() / 1000);
};
