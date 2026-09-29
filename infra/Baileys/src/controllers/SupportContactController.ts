import { Request, Response } from "express";
import {
  createFolder,
  listContacts,
  listFolders,
  openSupportConversation,
  removeFolder,
  showSupportTicket,
  unmarkSupportContact,
  updateFolder,
  upsertSupportContact
} from "../services/SupportServices/SupportContactService";

const asInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const indexFolders = async (req: Request, res: Response): Promise<Response> => {
  const folders = await listFolders(req.user.companyId);
  return res.json({ folders });
};

export const storeFolder = async (req: Request, res: Response): Promise<Response> => {
  const folder = await createFolder(req.user.companyId, String(req.body?.name || ""));
  return res.status(201).json(folder);
};

export const editFolder = async (req: Request, res: Response): Promise<Response> => {
  const folder = await updateFolder(
    req.user.companyId,
    Number(req.params.folderId),
    String(req.body?.name || "")
  );
  return res.json(folder);
};

export const destroyFolder = async (req: Request, res: Response): Promise<Response> => {
  await removeFolder(req.user.companyId, Number(req.params.folderId));
  return res.json({ ok: true });
};

export const indexContacts = async (req: Request, res: Response): Promise<Response> => {
  const folderId = asInt(req.query.folderId);
  const contacts = await listContacts(req.user.companyId, folderId || undefined);
  return res.json({ contacts });
};

export const storeContact = async (req: Request, res: Response): Promise<Response> => {
  const folderId = asInt(req.body?.folderId ?? req.body?.supportFolderId);
  if (!folderId) {
    return res.status(400).json({ error: "Pasta do sistema é obrigatória" });
  }
  const contact = await upsertSupportContact({
    companyId: req.user.companyId,
    name: String(req.body?.name || ""),
    number: String(req.body?.number || ""),
    folderId,
    supportWhatsappId: asInt(req.body?.supportWhatsappId ?? req.body?.whatsappId)
  });
  return res.status(201).json(contact);
};

export const editContact = async (req: Request, res: Response): Promise<Response> => {
  const folderId = asInt(req.body?.folderId ?? req.body?.supportFolderId);
  if (!folderId) {
    return res.status(400).json({ error: "Pasta do sistema é obrigatória" });
  }
  const contact = await upsertSupportContact({
    companyId: req.user.companyId,
    contactId: Number(req.params.contactId),
    name: String(req.body?.name || ""),
    number: String(req.body?.number || ""),
    folderId,
    supportWhatsappId: asInt(req.body?.supportWhatsappId ?? req.body?.whatsappId)
  });
  return res.json(contact);
};

export const destroyContact = async (req: Request, res: Response): Promise<Response> => {
  await unmarkSupportContact(req.user.companyId, Number(req.params.contactId));
  return res.json({ ok: true });
};

export const openConversation = async (req: Request, res: Response): Promise<Response> => {
  const ticket = await openSupportConversation({
    companyId: req.user.companyId,
    contactId: Number(req.params.contactId),
    userId: Number(req.user.id)
  });
  return res.status(201).json({ ticket });
};

export const showConversation = async (req: Request, res: Response): Promise<Response> => {
  const ticket = await showSupportTicket(req.user.companyId, Number(req.params.ticketId));
  return res.json({ ticket });
};
