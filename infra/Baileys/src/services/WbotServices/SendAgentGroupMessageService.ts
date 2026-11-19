import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import { toWhatsAppGroupJid } from "../../helpers/chatJid";
import { getWbot } from "../../libs/wbot";
import Prompt from "../../models/Prompt";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import { splitWhatsAppText } from "../AiServices/aiAgentActions";

interface Request {
  companyId: number;
  groupJid: string;
  body: string;
  whatsappId?: number;
}

const groupJidOf = (raw: string): string => {
  const jid = toWhatsAppGroupJid(raw || "");
  const bare = jid.replace(/@g\.us$/i, "");
  if (!/^\d{8,}$/.test(bare)) {
    throw new AppError("Grupo inválido", 400);
  }
  return `${bare}@g.us`;
};

/**
 * Envia texto ao grupo vinculado a um agente da empresa.
 * Só aceita o JID gravado em idleAlertGroupJid, e sai pela conexão desse agente.
 */
const SendAgentGroupMessageService = async ({
  companyId,
  groupJid,
  body,
  whatsappId
}: Request): Promise<{ ok: true; whatsappId: number; messageId: string; parts: number }> => {
  const jid = groupJidOf(groupJid);
  const text = (body || "").trim();
  if (!text) {
    throw new AppError("Mensagem vazia", 400);
  }
  if (text.length > 12000) {
    throw new AppError("Mensagem longa demais", 400);
  }

  const prompts = await Prompt.findAll({
    where: {
      companyId,
      idleAlertGroupJid: { [Op.ne]: null }
    },
    attributes: ["id", "idleAlertGroupJid"]
  });
  const owners = prompts.filter(prompt => {
    const configured = (prompt.idleAlertGroupJid || "").trim();
    if (!configured) return false;
    try {
      return groupJidOf(configured) === jid;
    } catch {
      return false;
    }
  });
  if (!owners.length) {
    throw new AppError("Esse grupo não está vinculado a um agente", 403);
  }

  const connections = await Whatsapp.findAll({
    where: {
      companyId,
      promptId: { [Op.in]: owners.map(prompt => prompt.id) }
    },
    attributes: ["id", "status", "name"]
  });
  const ordered = [...connections].sort((left, right) => {
    const rank = (row: Whatsapp) => {
      if (whatsappId && row.id === Number(whatsappId)) return 0;
      if (row.status === "CONNECTED") return 1;
      return 2;
    };
    return rank(left) - rank(right);
  });
  if (!ordered.length) {
    throw new AppError("Nenhuma conexão do agente encontrada", 400);
  }

  const parts = splitWhatsAppText(text);
  let lastError = "Não foi possível enviar a mensagem no grupo";
  for (const connection of ordered) {
    try {
      const wbot = getWbot(connection.id);
      let messageId = "";
      for (const part of parts) {
        const sent = await wbot.sendMessage(jid, { text: part });
        messageId = sent?.key?.id || messageId;
      }
      logger.info(
        `Mensagem do assistente enviada no grupo ${jid} pela conexão ${connection.id} (${parts.length} parte(s))`
      );
      return { ok: true, whatsappId: connection.id, messageId, parts: parts.length };
    } catch (err: any) {
      lastError = err?.message || String(err);
      logger.warn(`Falha ao enviar no grupo ${jid} pela conexão ${connection.id}: ${lastError}`);
    }
  }
  throw new AppError(lastError, 502);
};

export default SendAgentGroupMessageService;
