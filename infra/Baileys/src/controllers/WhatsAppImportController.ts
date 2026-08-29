import { Request, Response } from "express";
import AppError from "../errors/AppError";
import { purgeStaleImportUploads } from "../config/whatsappImportUpload";
import ImportWhatsAppHistoryService, {
  ParticipantMapping
} from "../services/TicketServices/ImportWhatsAppHistoryService";
import PreviewWhatsAppImportService from "../services/TicketServices/PreviewWhatsAppImportService";

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const file = req.file;

  if (!file) {
    throw new AppError("ERR_WHATSAPP_IMPORT_NO_FILE", 400);
  }

  purgeStaleImportUploads();

  const contactId = Number(req.body.contactId);
  if (!contactId || Number.isNaN(contactId)) {
    throw new AppError("ERR_WHATSAPP_IMPORT_CONTACT", 400);
  }

  const ticketStatus = (req.body.ticketStatus || "closed") as
    | "open"
    | "pending"
    | "closed";
  if (!["open", "pending", "closed"].includes(ticketStatus)) {
    throw new AppError("ERR_WHATSAPP_IMPORT_STATUS", 400);
  }

  let participantMapping: ParticipantMapping = {};
  try {
    const raw = req.body.participantMapping;
    participantMapping =
      typeof raw === "string" ? JSON.parse(raw) : raw || {};
  } catch {
    throw new AppError("ERR_WHATSAPP_IMPORT_MAPPING", 400);
  }

  const whatsappId = req.body.whatsappId
    ? Number(req.body.whatsappId)
    : undefined;
  const queueId = req.body.queueId ? Number(req.body.queueId) : undefined;
  const appendToExisting =
    req.body.appendToExisting === "true" ||
    req.body.appendToExisting === true ||
    req.body.appendToExisting === undefined;

  const result = await ImportWhatsAppHistoryService({
    companyId,
    userId: Number(userId),
    contactId,
    whatsappId,
    queueId,
    ticketStatus,
    participantMapping,
    filePath: file.path,
    originalName: file.originalname,
    appendToExisting
  });

  return res.status(200).json(result);
};

export const preview = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const file = req.file;

  if (!file) {
    throw new AppError("ERR_WHATSAPP_IMPORT_NO_FILE", 400);
  }

  purgeStaleImportUploads();

  const result = await PreviewWhatsAppImportService({
    filePath: file.path,
    originalName: file.originalname
  });

  return res.status(200).json(result);
};
