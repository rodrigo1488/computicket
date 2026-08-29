import { Request, Response } from "express";
import { getWbot } from "../libs/wbot";
import { getIO } from "../libs/socket";
import ShowWhatsAppService from "../services/WhatsappService/ShowWhatsAppService";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import UpdateWhatsAppService from "../services/WhatsappService/UpdateWhatsAppService";
import CloseTicketsByWhatsAppIdService from "../services/TicketServices/CloseTicketsByWhatsAppIdService";
import { logger } from "../utils/logger";

const store = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);
  
  // Não iniciar sessão Baileys para Instagram ou Gupshup
  if (whatsapp.type !== "instagram" && whatsapp.provider !== "gupshup") {
    await StartWhatsAppSession(whatsapp, companyId);
  } else {
    return res.status(400).json({ 
      message: "Esta conexão não requer inicialização de sessão (Instagram/Gupshup)." 
    });
  }

  return res.status(200).json({ message: "Starting session." });
};

const update = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const { whatsapp } = await UpdateWhatsAppService({
    whatsappId,
    companyId,
    whatsappData: { session: "" }
  });

  // Não iniciar sessão Baileys para Instagram ou Gupshup
  if (whatsapp.type !== "instagram" && whatsapp.provider !== "gupshup") {
    await StartWhatsAppSession(whatsapp, companyId);
  } else {
    return res.status(400).json({ 
      message: "Esta conexão não requer reinicialização de sessão (Instagram/Gupshup)." 
    });
  }

  return res.status(200).json({ message: "Starting session." });
};

const remove = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;
  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);

  // Tenta encerrar o socket primeiro para evitar sessão ativa em memória após limpar DB.
  try {
    const wbot = getWbot(whatsapp.id);
    await wbot.logout();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn({
      msg: "WhatsAppSessionController.remove: socket não estava inicializado para logout",
      whatsappId: whatsapp.id,
      error: errorMessage
    });
  }

  await whatsapp.update({ status: "DISCONNECTED", session: "" });
  await CloseTicketsByWhatsAppIdService(whatsapp.id);

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(
    `company-${companyId}-whatsappSession`,
    {
      action: "update",
      session: whatsapp
    }
  );

  return res.status(200).json({ message: "Session disconnected." });
};

export default { store, remove, update };
