import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { getWbot } from "../../libs/wbot";
import {
  toWhatsAppGroupJid,
  toWhatsAppPrivateJid
} from "../../helpers/chatJid";
import { getIO } from "../../libs/socket";
import { sanitizeContactProfilePicUrl } from "../../helpers/contactProfilePic";
import ShowContactService from "./ShowContactService";
import {
  clearProfilePicThrottle,
  forceRefreshContactProfilePic,
  ProfilePicFailReason
} from "./ContactProfilePicService";
import CacheInvalidationService from "../CacheServices/CacheInvalidationService";

const resolveWbotForContact = async (
  contact: Contact,
  companyId: number
) => {
  const ticket = await Ticket.findOne({
    where: { contactId: contact.id, companyId },
    order: [["updatedAt", "DESC"]]
  });

  if (ticket) {
    const wbot = await GetTicketWbot(ticket);
    if (wbot) {
      return wbot;
    }
  }

  const defaultWhatsapp = await GetDefaultWhatsApp(companyId);
  return getWbot(defaultWhatsapp.id);
};

export type RefreshContactProfilePicResult = {
  contact: Contact;
  updated: boolean;
  reason?: ProfilePicFailReason;
};

const RefreshContactProfilePicService = async (
  contactId: number,
  companyId: number
): Promise<RefreshContactProfilePicResult> => {
  const contact = await ShowContactService(contactId, companyId);

  if (contact.isGroup) {
    throw new AppError("Não é possível atualizar foto de grupo por este atalho", 400);
  }

  const wbot = await resolveWbotForContact(contact, companyId);
  const jid = contact.isGroup
    ? toWhatsAppGroupJid(contact.number)
    : toWhatsAppPrivateJid(contact.number);
  const safeNumber = contact.number.replace(/\D/g, "") || contact.number;

  await clearProfilePicThrottle(companyId, safeNumber);

  const { updated, reason } = await forceRefreshContactProfilePic(
    wbot,
    jid,
    companyId,
    safeNumber,
    contact.id
  );

  await contact.reload();

  contact.profilePicUrl = sanitizeContactProfilePicUrl(contact.profilePicUrl);

  void CacheInvalidationService.onContactChanged(companyId, contact.id);
  void CacheInvalidationService.onTicketChanged(companyId);

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
    action: "update",
    contact
  });

  return { contact, updated, reason };
};

export default RefreshContactProfilePicService;
