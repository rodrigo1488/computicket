import Form from "../../models/Form";
import FormResponse from "../../models/FormResponse";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import { normalizeBrazilPhoneForWhatsapp } from "../../helpers/NormalizeBrazilPhone";
import { getIO } from "../../libs/socket";

const DEFAULT_MESSAGES: Record<string, string> = {
  em_preparo: "👨‍🍳 Seu pedido está em preparo! Em breve estará pronto.",
  pronto: "✅ Seu pedido está pronto para retirada!",
  saiu_entrega: "🚚 Seu pedido saiu para entrega! Em breve chegaremos.",
  entregue: "✅ Obrigado! Seu pedido foi entregue. Bom apetite!",
};

interface Request {
  form: Form;
  response: FormResponse;
  newStatus: string;
}

const SendOrderStatusNotificationService = async ({
  form,
  response,
  newStatus,
}: Request): Promise<boolean> => {
  const formSettings = form.settings as any;
  if (formSettings?.disableWhatsAppMessages === true) {
    return false;
  }

  const statusesToNotify = ["em_preparo", "pronto", "saiu_entrega", "entregue"];
  if (!statusesToNotify.includes(newStatus)) {
    return false;
  }

  // IMPORTANTE: preferir o telefone digitado no formulário (answers),
  // pois responderPhone/contact.number podem ter sido normalizados “errado” no passado.
  let phoneRaw = "";
  if (response.answers?.length) {
    const phoneAnswer = response.answers.find(
      (a) => (a.field?.metadata as any)?.autoFieldType === "phone" || a.field?.fieldType === "phone"
    );
    if (phoneAnswer?.answer) {
      phoneRaw = String(phoneAnswer.answer);
    }
  }
  if (!phoneRaw) {
    phoneRaw = (response.responderPhone || "").trim();
  }
  if (!phoneRaw && response.contact?.number) {
    phoneRaw = String(response.contact.number || "").trim();
  }
  const phone = normalizeBrazilPhoneForWhatsapp(phoneRaw);
  if (!phone) {
    console.warn("SendOrderStatusNotification: não foi possível obter telefone", { responseId: response.id });
    return false;
  }

  const orderStatusMessages = formSettings?.orderStatusMessages || {};
  const customTemplate = (orderStatusMessages[newStatus] || "").trim();
  const template = customTemplate || DEFAULT_MESSAGES[newStatus];

  if (!template) {
    console.warn("SendOrderStatusNotification: template vazio para status", { newStatus, responseId: response.id });
    return false;
  }

  try {
    let whatsappToUse;
    const selectedWhatsappId = formSettings?.whatsappId;

    if (selectedWhatsappId) {
      const Whatsapp = (await import("../../models/Whatsapp")).default;
      whatsappToUse = await Whatsapp.findOne({
        where: {
          id: selectedWhatsappId,
          companyId: form.companyId,
          status: "CONNECTED",
        },
      });
      if (!whatsappToUse) {
        whatsappToUse = await GetDefaultWhatsApp(form.companyId);
      }
    } else {
      whatsappToUse = await GetDefaultWhatsApp(form.companyId);
    }

    if (!whatsappToUse) {
      console.warn("SendOrderStatusNotification: No WhatsApp available");
      return false;
    }

    let contact = response.contact;

    // Se já existe contato mas com número em formato antigo/errado, corrigir antes de criar/usar ticket
    if (contact?.number) {
      const normalizedContactNumber = normalizeBrazilPhoneForWhatsapp(String(contact.number));
      if (normalizedContactNumber && normalizedContactNumber !== String(contact.number)) {
        try {
          await contact.update({ number: normalizedContactNumber });
          await contact.reload();
        } catch {
          // se falhar, seguimos (melhor tentar enviar com o phone normalizado via novo contato/ticket)
        }
      }
    }

    if (!contact) {
      contact = await CreateOrUpdateContactService({
        name: response.responderName || "Cliente",
        number: phone,
        email: response.responderEmail,
        isGroup: false,
        companyId: form.companyId,
      });
    } else if (!contact.number || normalizeBrazilPhoneForWhatsapp(String(contact.number)) !== phone) {
      // Garantir que o contato do ticket fique com o mesmo número normalizado do pedido
      try {
        await contact.update({ number: phone });
        await contact.reload();
      } catch {
        // ignore
      }
    }

    const ticket = await FindOrCreateTicketService(
      contact,
      whatsappToUse.id,
      0,
      form.companyId
    );

    console.log("SendOrderStatusNotification: enviando mensagem", {
      responseId: response.id,
      status: newStatus,
      phone: phone.substring(0, 6) + "***",
    });
    await SendWhatsAppMessage({
      body: template,
      ticket,
    });
    console.log("SendOrderStatusNotification: mensagem enviada com sucesso", { responseId: response.id });

    // Fecha o ticket automaticamente após enviar a notificação.
    // Se o cliente responder, o wbotMessageListener reabrirá o ticket como "pending".
    await ticket.update({ status: "closed" });
    const io = getIO();
    io.to(`company-${form.companyId}-mainchannel`).emit(`company-${form.companyId}-ticket`, {
      action: "delete",
      ticket,
      ticketId: ticket.id,
    });

    return true;
  } catch (err: any) {
    console.error("SendOrderStatusNotification error:", err?.message);
    return false;
  }
};

export default SendOrderStatusNotificationService;
