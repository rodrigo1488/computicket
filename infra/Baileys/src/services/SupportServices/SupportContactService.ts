import { Op, UniqueConstraintError } from "sequelize";
import AppError from "../../errors/AppError";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import {
  buildSupportTicketCreate,
  isSupportTicket,
  SUPPORT_TICKET_STATUS
} from "../../helpers/supportContactRouting";
import { isValidPhoneNumber } from "../../helpers/validatePhoneNumber";
import Contact from "../../models/Contact";
import SupportFolder from "../../models/SupportFolder";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import ShowTicketService from "../TicketServices/ShowTicketService";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";

const digits = (value: string) => String(value || "").replace(/\D/g, "");

export const normalizeSupportNumber = (raw: string): string => {
  let number = digits(raw);
  if ((number.length === 10 || number.length === 11) && !number.startsWith("55")) {
    number = `55${number}`;
  }
  if (!isValidPhoneNumber(number)) {
    throw new AppError("Informe um telefone/WhatsApp válido, com DDD.", 400);
  }
  return number;
};

const assertFolder = async (folderId: number, companyId: number) => {
  const folder = await SupportFolder.findOne({ where: { id: folderId, companyId } });
  if (!folder) {
    throw new AppError("Pasta de sistema não encontrada", 404);
  }
  return folder;
};

const assertSupportWhatsapp = async (
  whatsappId: number | null,
  companyId: number
): Promise<number | null> => {
  if (!whatsappId) return null;
  const whatsapp = await ShowWhatsAppService(whatsappId, companyId);
  if (!whatsapp) {
    throw new AppError("Conexão não encontrada", 404);
  }
  return Number(whatsapp.id);
};

export const listFolders = async (companyId: number) => {
  const folders = await SupportFolder.findAll({
    where: { companyId },
    order: [["name", "ASC"]]
  });
  const counts = await Contact.findAll({
    where: { companyId, isSupport: true, supportFolderId: { [Op.ne]: null } },
    attributes: ["supportFolderId"]
  });
  const byFolder = new Map<number, number>();
  counts.forEach(contact => {
    const id = Number(contact.supportFolderId);
    byFolder.set(id, (byFolder.get(id) || 0) + 1);
  });
  return folders.map(folder => ({
    id: folder.id,
    name: folder.name,
    contactsCount: byFolder.get(folder.id) || 0
  }));
};

export const createFolder = async (companyId: number, name: string) => {
  const trimmed = name.trim();
  if (!trimmed) throw new AppError("Nome da pasta é obrigatório", 400);
  try {
    const folder = await SupportFolder.create({ name: trimmed.slice(0, 120), companyId });
    return { id: folder.id, name: folder.name, contactsCount: 0 };
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new AppError("Já existe uma pasta com esse nome", 409);
    }
    throw err;
  }
};

export const updateFolder = async (companyId: number, folderId: number, name: string) => {
  const folder = await assertFolder(folderId, companyId);
  const trimmed = name.trim();
  if (!trimmed) throw new AppError("Nome da pasta é obrigatório", 400);
  try {
    await folder.update({ name: trimmed.slice(0, 120) });
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new AppError("Já existe uma pasta com esse nome", 409);
    }
    throw err;
  }
  return { id: folder.id, name: folder.name };
};

export const removeFolder = async (companyId: number, folderId: number) => {
  const folder = await assertFolder(folderId, companyId);
  const used = await Contact.count({
    where: { companyId, supportFolderId: folder.id, isSupport: true }
  });
  if (used > 0) {
    throw new AppError("Remova os contatos da pasta antes de excluí-la", 409);
  }
  await folder.destroy();
};

const serializeContact = (
  contact: Contact,
  folder: SupportFolder | null,
  whatsapp: Whatsapp | null,
  ticket: Ticket | null
) => ({
  id: contact.id,
  name: contact.name,
  number: contact.number,
  isSupport: true,
  supportFolderId: contact.supportFolderId || null,
  supportWhatsappId: contact.supportWhatsappId || null,
  folder: folder ? { id: folder.id, name: folder.name } : null,
  connection: contact.supportWhatsappId
    ? {
        id: contact.supportWhatsappId,
        name: whatsapp?.name || "Conexão"
      }
    : { id: null, name: "Padrão" },
  conversation: ticket
    ? {
        id: ticket.id,
        status: ticket.status,
        unreadMessages: ticket.unreadMessages || 0,
        lastMessage: ticket.lastMessage || "",
        updatedAt: ticket.updatedAt
      }
    : null
});

export const listContacts = async (companyId: number, folderId?: number) => {
  const where: Record<string, unknown> = { companyId, isSupport: true };
  if (folderId) where.supportFolderId = folderId;
  const contacts = await Contact.findAll({
    where,
    include: [{ model: SupportFolder, as: "supportFolder", required: false }],
    order: [["name", "ASC"]]
  });
  const whatsappIds = [
    ...new Set(
      contacts
        .map(contact => contact.supportWhatsappId)
        .filter((id): id is number => !!id)
    )
  ];
  const whatsapps = whatsappIds.length
    ? await Whatsapp.findAll({
        where: { id: { [Op.in]: whatsappIds }, companyId },
        attributes: ["id", "name"]
      })
    : [];
  const whatsappById = new Map(whatsapps.map(item => [item.id, item]));
  const contactIds = contacts.map(contact => contact.id);
  const tickets = contactIds.length
    ? await Ticket.findAll({
        where: {
          companyId,
          status: SUPPORT_TICKET_STATUS,
          contactId: { [Op.in]: contactIds }
        },
        order: [["updatedAt", "DESC"]]
      })
    : [];
  const ticketsByContact = new Map<number, Ticket[]>();
  tickets.forEach(ticket => {
    const rows = ticketsByContact.get(ticket.contactId) || [];
    rows.push(ticket);
    ticketsByContact.set(ticket.contactId, rows);
  });
  const pickTicket = (contact: Contact) => {
    const rows = ticketsByContact.get(contact.id) || [];
    if (contact.supportWhatsappId) {
      const onChosenLine = rows.find(ticket => ticket.whatsappId === contact.supportWhatsappId);
      if (onChosenLine) return onChosenLine;
    }
    return rows[0] || null;
  };
  return contacts.map(contact =>
    serializeContact(
      contact,
      contact.supportFolder || null,
      contact.supportWhatsappId ? whatsappById.get(contact.supportWhatsappId) || null : null,
      pickTicket(contact)
    )
  );
};

export const upsertSupportContact = async (input: {
  companyId: number;
  contactId?: number;
  name: string;
  number: string;
  folderId: number;
  supportWhatsappId?: number | null;
}) => {
  const name = input.name.trim();
  if (!name) throw new AppError("Nome é obrigatório", 400);
  const folder = await assertFolder(input.folderId, input.companyId);
  const number = normalizeSupportNumber(input.number);
  const supportWhatsappId = await assertSupportWhatsapp(
    input.supportWhatsappId ? Number(input.supportWhatsappId) : null,
    input.companyId
  );

  let contact: Contact | null = null;
  if (input.contactId) {
    contact = await Contact.findOne({
      where: { id: input.contactId, companyId: input.companyId }
    });
    if (!contact) throw new AppError("Contato não encontrado", 404);
    if (contact.isGroup) {
      throw new AppError("Grupos não podem ser contatos de suporte", 400);
    }
    if (contact.number !== number) {
      const clash = await Contact.findOne({
        where: { number, companyId: input.companyId, id: { [Op.ne]: contact.id } }
      });
      if (clash) throw new AppError("Já existe um contato com esse número", 409);
    }
  } else {
    contact = await Contact.findOne({
      where: { number, companyId: input.companyId }
    });
  }

  if (contact) {
    await contact.update({
      name: name.slice(0, 250),
      number,
      isSupport: true,
      supportFolderId: folder.id,
      supportWhatsappId
    });
  } else {
    contact = await Contact.create({
      name: name.slice(0, 250),
      number,
      email: "",
      companyId: input.companyId,
      isSupport: true,
      supportFolderId: folder.id,
      supportWhatsappId
    });
  }

  const rows = await listContacts(input.companyId, folder.id);
  return rows.find(row => row.id === contact!.id) || rows[0];
};

export const unmarkSupportContact = async (companyId: number, contactId: number) => {
  const contact = await Contact.findOne({
    where: { id: contactId, companyId, isSupport: true }
  });
  if (!contact) throw new AppError("Contato de suporte não encontrado", 404);
  await contact.update({
    isSupport: false,
    supportFolderId: null,
    supportWhatsappId: null
  });
};

export const findOrCreateSupportTicket = async (input: {
  contact: Contact;
  companyId: number;
  whatsappId: number;
  unreadMessages: number;
  userId?: number | null;
}) => {
  let ticket = await Ticket.findOne({
    where: {
      contactId: input.contact.id,
      companyId: input.companyId,
      whatsappId: input.whatsappId,
      status: SUPPORT_TICKET_STATUS
    },
    order: [["id", "DESC"]]
  });

  if (!ticket) {
    try {
      ticket = await Ticket.create(
        buildSupportTicketCreate({
          contactId: input.contact.id,
          companyId: input.companyId,
          whatsappId: input.whatsappId,
          unreadMessages: input.unreadMessages,
          userId: input.userId
        })
      );
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;
      ticket = await Ticket.findOne({
        where: {
          contactId: input.contact.id,
          companyId: input.companyId,
          whatsappId: input.whatsappId,
          status: SUPPORT_TICKET_STATUS
        },
        order: [["id", "DESC"]]
      });
      if (!ticket) throw err;
    }
  } else if (input.unreadMessages) {
    await ticket.update({ unreadMessages: input.unreadMessages });
  }

  return ShowTicketService(ticket.id, input.companyId);
};

export const openSupportConversation = async (input: {
  companyId: number;
  contactId: number;
  userId?: number | null;
}) => {
  const contact = await Contact.findOne({
    where: { id: input.contactId, companyId: input.companyId, isSupport: true }
  });
  if (!contact) throw new AppError("Contato de suporte não encontrado", 404);

  let whatsappId = contact.supportWhatsappId || null;
  if (whatsappId) {
    await assertSupportWhatsapp(whatsappId, input.companyId);
  } else {
    const fallback = await GetDefaultWhatsApp(input.companyId, input.userId || undefined);
    whatsappId = fallback.id;
  }

  const ticket = await findOrCreateSupportTicket({
    contact,
    companyId: input.companyId,
    whatsappId,
    unreadMessages: 0,
    userId: input.userId
  });
  const folder = contact.supportFolderId
    ? await SupportFolder.findOne({
        where: { id: contact.supportFolderId, companyId: input.companyId }
      })
    : null;
  return presentSupportTicket(ticket, folder);
};

export const presentSupportTicket = (
  ticket: Ticket,
  folder: SupportFolder | null
) => ({
  id: ticket.id,
  status: ticket.status,
  isSupport: isSupportTicket(ticket),
  unreadMessages: ticket.unreadMessages || 0,
  lastMessage: ticket.lastMessage || "",
  whatsappId: ticket.whatsappId,
  contact: ticket.contact
    ? {
        id: ticket.contact.id,
        name: ticket.contact.name,
        number: ticket.contact.number,
        isSupport: ticket.contact.isSupport === true,
        supportFolderId: ticket.contact.supportFolderId || null,
        supportWhatsappId: ticket.contact.supportWhatsappId || null
      }
    : null,
  supportFolder: folder ? { id: folder.id, name: folder.name } : null
});

export const showSupportTicket = async (companyId: number, ticketId: number) => {
  const ticket = await ShowTicketService(ticketId, companyId);
  if (!isSupportTicket(ticket)) {
    throw new AppError("Conversa de suporte não encontrada", 404);
  }
  const folderId = ticket.contact?.supportFolderId;
  const folder = folderId
    ? await SupportFolder.findOne({ where: { id: folderId, companyId } })
    : null;
  return presentSupportTicket(ticket, folder);
};
