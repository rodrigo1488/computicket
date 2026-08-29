/**
 * Serializa processamento de mensagens do mesmo chat (remoteJid),
 * evitando race entre upserts paralelos que baguncam ordem e estado do ticket.
 */
const chatQueues = new Map<string, Promise<unknown>>();

export const runWithChatMutex = async <T>(
  chatKey: string,
  fn: () => Promise<T>
): Promise<T> => {
  const previous = chatQueues.get(chatKey) ?? Promise.resolve();
  const run = previous.then(() => fn());
  chatQueues.set(
    chatKey,
    run.catch(() => undefined)
  );
  try {
    return await run;
  } finally {
    if (chatQueues.get(chatKey) === run) {
      chatQueues.delete(chatKey);
    }
  }
};

export const buildChatMutexKey = (
  companyId: number,
  remoteJid: string | null | undefined
): string => `${companyId}:${remoteJid || "unknown"}`;
