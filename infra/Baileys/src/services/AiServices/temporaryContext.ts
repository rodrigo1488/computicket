import { Op } from "sequelize";
import AiTemporaryContext from "../../models/AiTemporaryContext";
import { logger } from "../../utils/logger";
import {
  formatTemporaryNotices,
  noticeSubjectMatches,
  parseTemporaryNotice,
  temporaryNoticeExpiry
} from "./aiAgentActions";

export async function listActiveTemporaryContexts(
  companyId: number,
  promptId: number
): Promise<AiTemporaryContext[]> {
  if (!companyId || !promptId) return [];
  try {
    return await AiTemporaryContext.findAll({
      where: {
        companyId,
        promptId,
        clearedAt: { [Op.is]: null },
        expiresAt: { [Op.gt]: new Date() }
      },
      order: [["id", "ASC"]]
    });
  } catch (err: any) {
    logger.warn(`Avisos temporários indisponíveis: ${err?.message || err}`);
    return [];
  }
}

export async function temporaryNoticeBlock(companyId: number, promptId: number): Promise<string> {
  const notes = await listActiveTemporaryContexts(companyId, promptId);
  return formatTemporaryNotices(notes.map(note => ({ body: note.body })));
}

export async function rememberTemporaryContext(input: {
  companyId: number;
  promptId: number;
  body: string;
  days: number;
  sourceMessageId?: string | null;
}): Promise<AiTemporaryContext | null> {
  const body = (input.body || "").trim().slice(0, 300);
  if (!input.companyId || !input.promptId || body.length < 5) return null;
  if (input.sourceMessageId) {
    const existing = await AiTemporaryContext.findOne({
      where: { promptId: input.promptId, sourceMessageId: input.sourceMessageId }
    });
    if (existing) return existing;
  }
  return AiTemporaryContext.create({
    companyId: input.companyId,
    promptId: input.promptId,
    body,
    expiresAt: temporaryNoticeExpiry(input.days),
    clearedAt: null,
    sourceMessageId: input.sourceMessageId || null
  });
}

export async function clearTemporaryContexts(input: {
  companyId: number;
  promptId: number;
  subject: string;
}): Promise<number> {
  const notes = await listActiveTemporaryContexts(input.companyId, input.promptId);
  const hits = notes.filter(note => noticeSubjectMatches(note.body, input.subject));
  if (!hits.length) return 0;
  const now = new Date();
  await AiTemporaryContext.update(
    { clearedAt: now },
    { where: { id: { [Op.in]: hits.map(note => note.id) } } }
  );
  return hits.length;
}

export function temporaryNoticeInstruction(): string {
  return `A mensagem é de um colega no grupo interno.
Decida uma ação:
- guardar: ele informa um fato temporário para os clientes, como sistema fora ou expediente especial. Não é pergunta.
- encerrar: ele diz que o fato acabou ou pede para esquecer o aviso.
- responder: pergunta ou conversa que não é um aviso.
texto: uma frase curta só com o que ele disse, sem completar e sem inventar. No encerrar, o assunto a apagar.
validade: hoje, amanha ou semana. Se ele não disser o prazo, use hoje.
Retorne somente JSON: {"acao":"guardar","texto":"...","validade":"hoje"}`;
}

export function temporaryNoticeReply(raw: string): { action: "guardar" | "encerrar" | "responder"; text: string; days: number } {
  return parseTemporaryNotice(raw) || { action: "responder", text: "", days: 0 };
}
