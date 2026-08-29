import Form from "../../models/Form";
import FormResponse from "../../models/FormResponse";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import { normalizeBrazilPhoneForWhatsapp } from "../../helpers/NormalizeBrazilPhone";

const DEFAULT_EVALUATION_MESSAGE =
  "📋 Como foi sua experiência? Avalie nosso atendimento respondendo esta mensagem. Obrigado!";

interface Request {
  form: Form;
  response: FormResponse;
}

const SendOrderEvaluationService = async ({
  form,
  response,
}: Request): Promise<boolean> => {
  let phone = (response.responderPhone || "").trim();
  if (!phone && response.contact?.number) {
    phone = normalizeBrazilPhoneForWhatsapp(response.contact.number);
  }
  if (!phone && response.answers?.length) {
    const phoneAnswer = response.answers.find(
      (a) => (a.field?.metadata as any)?.autoFieldType === "phone" || a.field?.fieldType === "phone"
    );
    if (phoneAnswer?.answer) {
      phone = normalizeBrazilPhoneForWhatsapp(String(phoneAnswer.answer));
    }
  }
  if (!phone) return false;

  const formSettings = form.settings as any;
  const template =
    (formSettings?.evaluationMessage || "").trim() || DEFAULT_EVALUATION_MESSAGE;

  try {
    const whatsappToUse = formSettings?.whatsappId
      ? await (await import("../../models/Whatsapp")).default.findOne({
          where: {
            id: formSettings.whatsappId,
            companyId: form.companyId,
            status: "CONNECTED",
          },
        })
      : null;
    const wpp = whatsappToUse || (await GetDefaultWhatsApp(form.companyId));
    if (!wpp) return false;

    let contact = response.contact;
    if (!contact) {
      contact = await CreateOrUpdateContactService({
        name: response.responderName || "Cliente",
        number: phone,
        email: response.responderEmail,
        isGroup: false,
        companyId: form.companyId,
      });
    }

    const ticket = await FindOrCreateTicketService(
      contact,
      wpp.id,
      0,
      form.companyId
    );
    await SendWhatsAppMessage({ body: template, ticket });
    return true;
  } catch {
    return false;
  }
};

export default SendOrderEvaluationService;
