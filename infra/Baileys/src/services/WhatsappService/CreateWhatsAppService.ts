import * as Yup from "yup";

import AppError from "../../errors/AppError";
import Whatsapp from "../../models/Whatsapp";
import Company from "../../models/Company";
import Plan from "../../models/Plan";
import AssociateWhatsappQueue from "./AssociateWhatsappQueue";

interface Request {
  name: string;
  companyId: number;
  queueIds?: number[];
  greetingMessage?: string;
  complationMessage?: string;
  outOfHoursMessage?: string;
  ratingMessage?: string;
  status?: string;
  isDefault?: boolean;
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
  type?: string;
  fbPageId?: string;
  facebookUserToken?: string;
  tokenStore?: string;
}

interface Response {
  whatsapp: Whatsapp;
  oldDefaultWhatsapp: Whatsapp | null;
}

const CreateWhatsAppService = async ({
  name,
  status,
  queueIds = [],
  greetingMessage,
  complationMessage,
  outOfHoursMessage,
  ratingMessage,
  isDefault = false,
  companyId,
  token = "",
  provider = "beta",
  gupshupApiKey,
  gupshupAppName,
  //timeSendQueue,
  //sendIdQueue,
  transferQueueId,
  timeToTransfer,
  promptId,
  maxUseBotQueues = 3,
  timeUseBotQueues = 0,
  expiresTicket = 0,
  expiresInactiveMessage = "",
  integrationId = null,
  type = "whatsapp",
  fbPageId,
  facebookUserToken,
  tokenStore
}: Request): Promise<Response> => {
  // CORRIGIDO: Se provider for "instagram", garantir que type também seja "instagram"
  // Isso deve ser feito ANTES de definir o status padrão para evitar que o valor padrão do modelo sobrescreva
  if (provider === "instagram") {
    type = "instagram";
  }

  // Definir status padrão baseado no tipo de conexão
  // Instagram e Gupshup não precisam de QR code, então começam como CONNECTED
  if (!status) {
    if (type === "instagram" || provider === "gupshup") {
      status = "CONNECTED";
    } else {
      status = "OPENING"; // WhatsApp precisa de QR code
    }
  }

  const company = await Company.findOne({
    where: {
      id: companyId
    },
    include: [{ model: Plan, as: "plan" }]
  });

  if (company !== null) {
    const whatsappCount = await Whatsapp.count({
      where: {
        companyId
      }
    });

    if (whatsappCount >= company.plan.connections) {
      throw new AppError(
        `Número máximo de conexões já alcançado: ${whatsappCount}`
      );
    }
  }

  const schema = Yup.object().shape({
    name: Yup.string()
      .required()
      .min(2)
      .test(
        "Check-name",
        "Esse nome já está sendo utilizado por outra conexão",
        async value => {
          if (!value) return false;
          const nameExists = await Whatsapp.findOne({
            where: { name: value, companyId }
          });
          return !nameExists;
        }
      ),
    isDefault: Yup.boolean().required()
  });

  try {
    await schema.validate({ name, status, isDefault });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const whatsappFound = await Whatsapp.findOne({ where: { companyId } });

  isDefault = !whatsappFound;

  let oldDefaultWhatsapp: Whatsapp | null = null;

  if (isDefault) {
    oldDefaultWhatsapp = await Whatsapp.findOne({
      where: { isDefault: true, companyId }
    });
    if (oldDefaultWhatsapp) {
      await oldDefaultWhatsapp.update({ isDefault: false, companyId });
    }
  }

  // Validar campos Instagram se provider for "instagram"
  // O tipo já foi definido acima, então apenas validamos e definimos status
  if (provider === "instagram") {
    if (!fbPageId || !facebookUserToken) {
      throw new AppError(
        "Campos ID da Página e Token de Usuário são obrigatórios para Instagram"
      );
    }
    const VerifyInstagram = require("../../services/InstagramServices/VerifyInstagram").default;
    await VerifyInstagram({ token: facebookUserToken });

    // Status inicial para Instagram é CONNECTED (não precisa QR code)
    status = "CONNECTED";
  }

  // Validar campos Gupshup se provider for "gupshup"
  if (provider === "gupshup") {
    if (!gupshupApiKey || !gupshupAppName) {
      throw new AppError(
        "Campos gupshupApiKey e gupshupAppName são obrigatórios quando provider é 'gupshup'"
      );
    }
    // Status inicial para Gupshup é CONNECTED (não precisa QR code)
    status = "CONNECTED";
  }

  // Validar campos Instagram se type for "instagram" (fallback caso provider não seja definido)
  if (type === "instagram" && provider !== "instagram") {
    if (!fbPageId || !facebookUserToken) {
      throw new AppError(
        "Campos ID da Página e Token de Usuário são obrigatórios para Instagram"
      );
    }
    const VerifyInstagram = require("../../services/InstagramServices/VerifyInstagram").default;
    await VerifyInstagram({ token: facebookUserToken });

    // Status inicial para Instagram é CONNECTED (não precisa QR code)
    status = "CONNECTED";
  }

  if (queueIds.length > 1 && !greetingMessage) {
    throw new AppError("ERR_WAPP_GREETING_REQUIRED");
  }

  if (token !== null && token !== "") {
    const tokenSchema = Yup.object().shape({
      token: Yup.string()
        .required()
        .min(2)
        .test(
          "Check-token",
          "This whatsapp token is already used.",
          async value => {
            if (!value) return false;
            const tokenExists = await Whatsapp.findOne({
              where: { token: value, companyId }
            });
            return !tokenExists;
          }
        )
    });

    try {
      await tokenSchema.validate({ token });
    } catch (err: any) {
      throw new AppError(err.message);
    }
  }

  const whatsapp = await Whatsapp.create(
    {
      name,
      status,
      greetingMessage,
      complationMessage,
      outOfHoursMessage,
      ratingMessage,
      isDefault,
      companyId,
      token,
      provider,
      gupshupApiKey: provider === "gupshup" ? gupshupApiKey : null,
      gupshupAppName: provider === "gupshup" ? gupshupAppName : null,
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
      type,
      fbPageId,
      facebookUserToken,
      tokenStore
    },
    { include: ["queues"] }
  );

  await AssociateWhatsappQueue(whatsapp, queueIds);

  // Se for Gupshup, validar conexão após criar
  if (provider === "gupshup") {
    try {
      const { ValidateGupshupConnection } = await import("../GupshupServices/ValidateGupshupConnection");
      await ValidateGupshupConnection(whatsapp);
    } catch (error) {
      // Log do erro mas não falha a criação
      console.error("Erro ao validar conexão Gupshup:", error);
    }
  }

  return { whatsapp, oldDefaultWhatsapp };
};

export default CreateWhatsAppService;
