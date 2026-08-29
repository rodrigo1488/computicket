import { initWASocket } from "../../libs/wbot";
import { loadBaileys } from "../../libs/baileysModule";
import Whatsapp from "../../models/Whatsapp";
import { wbotMessageListener } from "./wbotMessageListener";
import { getIO } from "../../libs/socket";
import wbotMonitor from "./wbotMonitor";
import { logger } from "../../utils/logger";
import * as Sentry from "@sentry/node";

export const StartWhatsAppSession = async (
  whatsapp: Whatsapp,
  companyId: number
): Promise<void> => {
  logger.info(`StartWhatsAppSession - ID: ${whatsapp.id} | Name: ${whatsapp.name} | Provider: ${whatsapp.provider} | Type: ${whatsapp.type}`);

  // Se provider for Gupshup ou Instagram, não iniciar sessão Baileys
  if (whatsapp.provider === "gupshup" || whatsapp.type === "instagram") {
    logger.info(`Sessão ${whatsapp.name} é ${whatsapp.type || whatsapp.provider}. Não iniciando sessão Baileys.`);
    // Apenas garantir que o status está correto e inicializar Adapter se necessário
    if (whatsapp.status !== "CONNECTED") {
      await whatsapp.update({ status: "CONNECTED" });
    }
    return;
  }

  // Baileys 7 é ESM-only — carregar antes de qualquer uso via Proxy/getBaileys
  await loadBaileys();

  // Verificar se já existe uma sessão ativa antes de iniciar nova
  // IMPORTANTE: Mesmo se a sessão existir, precisamos garantir que os listeners estão registrados
  // pois durante reconexão, a sessão pode ter sido recriada sem listeners
  try {
    const { getWbot } = await import("../../libs/wbot");
    const existingWbot = getWbot(whatsapp.id);
    
    // Verificar se a sessão tem a propriedade customizada que indica listeners registrados
    // Usamos uma propriedade customizada no wbot para rastrear isso
    const hasListenersFlag = (existingWbot as any).__listenersRegistered === true;
    
    if (hasListenersFlag) {
      // Sessão existe E tem listeners - tudo OK
      logger.info(`Sessão ${whatsapp.name} já está ativa com listeners. Não reiniciando.`);
      return;
    } else {
      // Sessão existe mas SEM listeners - re-registrar (pode ter acontecido durante reconexão)
      logger.warn({
        msg: `Sessão ${whatsapp.name} existe mas sem listeners. Re-registrando listeners.`,
        whatsappId: whatsapp.id,
        companyId
      });
      wbotMessageListener(existingWbot, companyId);
      wbotMonitor(existingWbot, whatsapp, companyId);
      // Marcar que listeners foram registrados
      (existingWbot as any).__listenersRegistered = true;
      return;
    }
  } catch (err) {
    // Se não existe sessão (erro ERR_WAPP_NOT_INITIALIZED), continuar com a inicialização
    logger.debug(`Sessão ${whatsapp.name} não existe. Iniciando nova sessão.`);
  }

  await whatsapp.update({ status: "OPENING" });

  const io = getIO();
  io.to(`company-${whatsapp.companyId}-mainchannel`).emit(
    `company-${whatsapp.companyId}-whatsappSession`,
    {
      action: "update",
      session: whatsapp
    }
  );

  try {
    const wbot = await initWASocket(whatsapp);
    wbotMessageListener(wbot, companyId);
    wbotMonitor(wbot, whatsapp, companyId);
    // Marcar que listeners foram registrados
    (wbot as any).__listenersRegistered = true;
  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }
};
