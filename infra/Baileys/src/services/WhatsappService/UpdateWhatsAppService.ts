import * as Yup from "yup";
import { Op } from "sequelize";

import AppError from "../../errors/AppError";
import Whatsapp from "../../models/Whatsapp";
import ShowWhatsAppService from "./ShowWhatsAppService";
import AssociateWhatsappQueue from "./AssociateWhatsappQueue";

interface WhatsappData {
  name?: string;
  status?: string;
  session?: string;
  isDefault?: boolean;
  greetingMessage?: string;
  complationMessage?: string;
  outOfHoursMessage?: string;
  ratingMessage?: string;
  queueIds?: number[];
  token?: string;
  provider?: string;
  gupshupApiKey?: string;
  gupshupAppName?: string;
  //sendIdQueue?: number;
  //timeSendQueue?: number;
  transferQueueId?: number; 
  timeToTransfer?: number;    
  promptId?: number;
  maxUseBotQueues?: number;
  timeUseBotQueues?: number;
  expiresTicket?: number;
  expiresInactiveMessage?: string;
  integrationId?: number;
  flowIdWelcome?: number;
  flowIdNotPhrase?: number;
}

interface Request {
  whatsappData: WhatsappData;
  whatsappId: string;
  companyId: number;
}

interface Response {
  whatsapp: Whatsapp;
  oldDefaultWhatsapp: Whatsapp | null;
}

const UpdateWhatsAppService = async ({
  whatsappData,
  whatsappId,
  companyId
}: Request): Promise<Response> => {
  const schema = Yup.object().shape({
    name: Yup.string().min(2),
    status: Yup.string(),
    isDefault: Yup.boolean()
  });

  const {
    name,
    status,
    isDefault,
    session,
    greetingMessage,
    complationMessage,
    outOfHoursMessage,
    ratingMessage,
    queueIds = [],
    token,
    provider,
    gupshupApiKey,
    gupshupAppName,
    //timeSendQueue,
    //sendIdQueue = null,
    transferQueueId,	
	  timeToTransfer,	
    promptId,
    maxUseBotQueues,
    timeUseBotQueues,
    expiresTicket,
    expiresInactiveMessage,
    integrationId,
    flowIdWelcome,
    flowIdNotPhrase
  } = whatsappData;

  try {
    await schema.validate({ name, status, isDefault });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  if (queueIds.length > 1 && !greetingMessage) {
    throw new AppError("ERR_WAPP_GREETING_REQUIRED");
  }

  let oldDefaultWhatsapp: Whatsapp | null = null;

  if (isDefault) {
    oldDefaultWhatsapp = await Whatsapp.findOne({
      where: {
        isDefault: true,
        id: { [Op.not]: whatsappId },
        companyId
      }
    });
    if (oldDefaultWhatsapp) {
      await oldDefaultWhatsapp.update({ isDefault: false });
    }
  }

  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);

  // Se estiver atualizando o nome, garantir unicidade por empresa (excluindo esta conexão)
  if (name && name.trim() && name !== whatsapp.name) {
    const nameExists = await Whatsapp.findOne({
      where: { name: name.trim(), companyId, id: { [Op.not]: whatsappId } }
    });
    if (nameExists) {
      throw new AppError("Esse nome já está sendo utilizado por outra conexão", 400);
    }
  }

  // Se estiver atualizando credenciais Gupshup, validar
  const isUpdatingGupshup = provider === "gupshup" || (whatsapp.provider === "gupshup" && (gupshupApiKey || gupshupAppName));
  
  await whatsapp.update({
    name,
    status,
    session,
    greetingMessage,
    complationMessage,
    outOfHoursMessage,
    ratingMessage,
    isDefault,
    companyId,
    token,
    provider: provider || whatsapp.provider,
    gupshupApiKey: isUpdatingGupshup && gupshupApiKey !== undefined ? gupshupApiKey : whatsapp.gupshupApiKey,
    gupshupAppName: isUpdatingGupshup && gupshupAppName !== undefined ? gupshupAppName : whatsapp.gupshupAppName,
    //timeSendQueue,
    //sendIdQueue,
    transferQueueId,	
	  timeToTransfer,	
    promptId,
    maxUseBotQueues,
    timeUseBotQueues,
    expiresTicket,
    expiresInactiveMessage,
    integrationId,
    flowIdWelcome,
    flowIdNotPhrase
  });

  await AssociateWhatsappQueue(whatsapp, queueIds);

  // Se atualizou credenciais Gupshup, validar conexão
  if (isUpdatingGupshup) {
    try {
      const { ValidateGupshupConnection } = await import("../GupshupServices/ValidateGupshupConnection");
      await ValidateGupshupConnection(whatsapp);
    } catch (error) {
      // Log do erro mas não falha a atualização
      console.error("Erro ao validar conexão Gupshup após atualização:", error);
    }
  }

  return { whatsapp, oldDefaultWhatsapp };
};

export default UpdateWhatsAppService;
