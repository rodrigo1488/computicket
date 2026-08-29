import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import ListMesasService from "../services/MesaServices/ListMesasService";
import CreateMesaService from "../services/MesaServices/CreateMesaService";
import CreateBulkMesasService from "../services/MesaServices/CreateBulkMesasService";
import UpdateMesaService from "../services/MesaServices/UpdateMesaService";
import ShowMesaService from "../services/MesaServices/ShowMesaService";
import OcuparMesaService from "../services/MesaServices/OcuparMesaService";
import LiberarMesaService from "../services/MesaServices/LiberarMesaService";
import AtualizarNomeContatoMesaService from "../services/MesaServices/AtualizarNomeContatoMesaService";
import ResumoContaMesaService from "../services/MesaServices/ResumoContaMesaService";
import DeleteMesaService from "../services/MesaServices/DeleteMesaService";
import ValidateMesaRestoreQrService from "../services/MesaServices/ValidateMesaRestoreQrService";
import RestoreMesaFromQrService from "../services/MesaServices/RestoreMesaFromQrService";
import RegisterGourmetVendaService from "../services/GourmetFinanceiroServices/RegisterGourmetVendaService";
import { applyDiscount, validatePayments } from "../helpers/gourmetOrderTotals";
import GetOrCreateDefaultCardapioFormService from "../services/FormServices/GetOrCreateDefaultCardapioFormService";
import { Op } from "sequelize";
import Form from "../models/Form";
import Mesa from "../models/Mesa";
import Ticket from "../models/Ticket";
import Product from "../models/Product";
import AddOnGroup from "../models/AddOnGroup";
import AddOnSubgroup from "../models/AddOnSubgroup";
import AddOnItem from "../models/AddOnItem";
import GrupoAddOn from "../models/GrupoAddOn";
import AppError from "../errors/AppError";
import { setPublicApiNoCacheHeaders } from "../helpers/setPublicApiNoCacheHeaders";
import { assertCompanyPublicAccess } from "../helpers/companyPublicAccess";
import { findPublicFormBySlug } from "../services/FormServices/FindPublicFormService";
import { signMesaLink, verifyMesaLink, signMesaLinkOnly, verifyMesaLinkOnly, createOrderToken } from "../helpers/MesaLinkSign";
import Contact from "../models/Contact";
import CreateTicketService from "../services/TicketServices/CreateTicketService";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";
import MesaOccupationConfirmation from "../models/MesaOccupationConfirmation";
import { v4 as uuidv4 } from "uuid";

const getFrontendBaseUrl = (): string => {
  const baseUrl = process.env.FRONTEND_URL || process.env.BACKEND_URL || "http://localhost:3000";
  return baseUrl.replace(/\/$/, "");
};

const MESA_OCCUPATION_KEYWORD_EXPIRES_MINUTES = 10;
const KEYWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const generateOccupationKeyword = (length = 6): string => {
  let keyword = "";
  for (let i = 0; i < length; i += 1) {
    keyword += KEYWORD_ALPHABET[Math.floor(Math.random() * KEYWORD_ALPHABET.length)];
  }
  return keyword;
};

const isPlaceholderPhone = (number?: string | null): boolean =>
  !number || number.startsWith("SEMTELEFONE-");

const isKeywordValidationEnabled = async (
  mesa: Mesa,
  createdBy?: number
): Promise<boolean> => {
  let form: Form | null = null;
  if (mesa.formId) {
    form = await Form.findOne({
      where: { id: mesa.formId, companyId: mesa.companyId, isActive: true },
      attributes: ["id", "settings"],
    });
  }
  if (!form) {
    form = await GetOrCreateDefaultCardapioFormService({
      companyId: mesa.companyId,
      createdBy,
    });
  }
  const settings = (form.settings || {}) as Record<string, unknown>;
  return settings.mesaOccupationKeywordValidation === true;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { status, type, formId, section } = req.query;

  const mesas = await ListMesasService({
    companyId,
    status: status as string,
    type: type as string,
    formId: formId ? Number(formId) : undefined,
    section: section as string,
  });

  const base = getFrontendBaseUrl();
  const list = mesas.map((m) => ({
    ...m.get({ plain: true }),
    linkUrl: `${base}/mesa/${m.id}?t=${signMesaLinkOnly(companyId, m.id)}`,
  }));
  return res.json(list);
};

/** Retorna links assinados para QR de todas as mesas (mesas independentes do formulário). */
export const getMesasLinksQr = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;

  const mesas = await Mesa.findAll({
    where: { companyId },
    attributes: ["id", "number", "name"],
    order: [["displayOrder", "ASC"], ["number", "ASC"], ["id", "ASC"]],
  });

  const base = getFrontendBaseUrl();
  const items = mesas.map((m) => {
    const token = signMesaLinkOnly(companyId, m.id);
    const url = `${base}/mesa/${m.id}?t=${token}`;
    return {
      mesaId: m.id,
      number: m.number,
      name: m.name,
      label: m.name || m.number || `Mesa ${m.id}`,
      url,
    };
  });

  return res.json({ items });
};

export const byIdentifier = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { number, type } = req.query;

  if (!number || typeof number !== "string" || !number.trim()) {
    throw new AppError("ERR_MESA_NUMBER_REQUIRED", 400);
  }

  const normalizedType = type === "comanda" ? "comanda" : "mesa";

  const mesa = await Mesa.findOne({
    where: {
      companyId,
      number: number.trim(),
      type: normalizedType,
    },
    include: [
      { association: "contact", attributes: ["id", "name", "number"] },
    ],
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  return res.json(mesa);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const mesa = await ShowMesaService({
    mesaId: Number(id),
    companyId,
  });

  return res.json(mesa);
};

/** PDV: localizar mesa/comanda por número e tipo. Query: number, type (mesa | comanda). */
export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const data = req.body;

  const schema = Yup.object().shape({
    number: Yup.string().required("Número da mesa é obrigatório"),
    name: Yup.string().nullable(),
    type: Yup.string().oneOf(["mesa", "comanda"]).nullable(),
    formId: Yup.number().nullable(),
    capacity: Yup.number().nullable(),
    section: Yup.string().nullable(),
    displayOrder: Yup.number().nullable(),
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const mesa = await CreateMesaService({
    ...data,
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "create",
    mesa,
  });

  return res.status(200).json(mesa);
};

export const validateRestoreQr = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { qrContent } = req.body;

  if (!qrContent || typeof qrContent !== "string") {
    throw new AppError("ERR_MESA_QR_INVALID", 400);
  }

  const result = await ValidateMesaRestoreQrService({
    companyId,
    qrContent: qrContent.trim(),
  });

  return res.status(200).json(result);
};

export const restoreFromQr = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const data = req.body;

  const schema = Yup.object().shape({
    qrContent: Yup.string().required(),
    number: Yup.string().required(),
    name: Yup.string().nullable(),
    type: Yup.string().oneOf(["mesa", "comanda"]).nullable(),
    formId: Yup.number().nullable(),
    capacity: Yup.number().nullable(),
    section: Yup.string().nullable(),
    displayOrder: Yup.number().nullable(),
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const mesa = await RestoreMesaFromQrService({
    companyId,
    qrContent: String(data.qrContent).trim(),
    number: data.number,
    name: data.name,
    type: data.type === "comanda" ? "comanda" : "mesa",
    formId: data.formId ?? null,
    capacity: data.capacity ?? null,
    section: data.section ?? null,
    displayOrder: data.displayOrder ?? 0,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "restore",
    mesa,
  });

  return res.status(200).json(mesa);
};

export const storeBulk = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { count, prefix, suffix, startFrom, formId, type } = req.body;

  const schema = Yup.object().shape({
    count: Yup.number().required().min(1).max(50),
    prefix: Yup.string().nullable(),
    suffix: Yup.string().nullable(),
    startFrom: Yup.number().nullable(),
    formId: Yup.number().nullable(),
    type: Yup.string().oneOf(["mesa", "comanda"]).nullable(),
  });

  try {
    await schema.validate({ count, prefix, suffix, startFrom, formId, type });
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const normalizedType = type === "comanda" ? "comanda" : "mesa";

  const mesas = await CreateBulkMesasService({
    companyId,
    count,
    prefix,
    suffix: suffix || "",
    startFrom: startFrom ?? 1,
    formId: formId ?? null,
    type: normalizedType,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "bulkCreate",
    mesas,
  });

  return res.status(200).json(mesas);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;
  const data = req.body;

  const schema = Yup.object().shape({
    number: Yup.string().nullable(),
    name: Yup.string().nullable(),
    type: Yup.string().oneOf(["mesa", "comanda"]).nullable(),
    formId: Yup.number().nullable(),
    capacity: Yup.number().nullable(),
    section: Yup.string().nullable(),
    displayOrder: Yup.number().nullable(),
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const mesa = await UpdateMesaService({
    mesaId: Number(id),
    companyId,
    ...data,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "update",
    mesa,
  });

  return res.status(200).json(mesa);
};

export const ocupar = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;
  const userId = parseInt(req.user.id);
  const { contactId, ticketId, transferir, contactName } = req.body;

  const schema = Yup.object().shape({
    contactId: Yup.number().nullable(),
    contactName: Yup.string().nullable(),
    ticketId: Yup.number().nullable(),
    transferir: Yup.boolean().nullable(),
  });

  try {
    await schema.validate({ contactId, ticketId, transferir, contactName });
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  let resolvedContactId = contactId;
  if (!resolvedContactId) {
    const name = String(contactName || "").trim();
    if (!name) {
      throw new AppError("ERR_CONTACT_REQUIRED", 400);
    }
    // Criar contato \"sem telefone\" com número único (campo Contact.number é obrigatório/único)
    const pseudoNumber = `SEMTELEFONE-${companyId}-${uuidv4()}`;
    const created = await Contact.create({
      name,
      number: pseudoNumber,
      email: "",
      companyId,
      userId: null,
      profilePicUrl: "",
      isGroup: false,
      disableBot: true,
    } as any);
    resolvedContactId = created.id;
  }

  const mesaEntity = await Mesa.findOne({
    where: { id: Number(id), companyId },
    attributes: ["id", "companyId", "formId", "status"],
  });
  if (!mesaEntity) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  const resolvedContact = await Contact.findOne({
    where: { id: resolvedContactId, companyId },
    attributes: ["id", "name", "number"],
  });
  if (!resolvedContact) {
    throw new AppError("ERR_CONTACT_NOT_FOUND", 404);
  }

  const keywordValidationEnabled = await isKeywordValidationEnabled(mesaEntity, userId);
  const shouldSendKeyword = keywordValidationEnabled && !isPlaceholderPhone(resolvedContact.number);

  if (shouldSendKeyword) {
    if (mesaEntity.status === "ocupada") {
      throw new AppError("ERR_MESA_ALREADY_OCCUPIED", 400);
    }

    let messageTicket: Ticket | null = null;
    if (ticketId && Number.isFinite(Number(ticketId))) {
      messageTicket = await Ticket.findOne({
        where: { id: Number(ticketId), companyId },
        include: [{ association: "contact" }],
      });
    }

    if (!messageTicket) {
      messageTicket = await CreateTicketService({
        contactId: resolvedContact.id,
        status: "open",
        userId,
        companyId,
        reuseOpenTicket: true,
      });
      await messageTicket.reload({ include: [{ association: "contact" }] });
    }

    const keyword = generateOccupationKeyword(6);
    const expiresAt = new Date(Date.now() + MESA_OCCUPATION_KEYWORD_EXPIRES_MINUTES * 60 * 1000);

    await MesaOccupationConfirmation.update(
      { status: "cancelled" },
      {
        where: {
          mesaId: mesaEntity.id,
          companyId,
          status: "pending",
        },
      }
    );

    const confirmation = await MesaOccupationConfirmation.create({
      mesaId: mesaEntity.id,
      companyId,
      contactId: resolvedContact.id,
      ticketId: messageTicket.id,
      transferir: !!transferir,
      keyword,
      status: "pending",
      expiresAt,
    });

    await SendWhatsAppMessage({
      ticket: messageTicket,
      body: `Confirmação de ocupação de mesa\n\nSua palavra-chave é: *${keyword}*\n\nInforme esta palavra ao atendente para liberar a ocupação.\nValidade: ${MESA_OCCUPATION_KEYWORD_EXPIRES_MINUTES} minutos.`,
    });

    return res.status(202).json({
      status: "pending_confirmation",
      mesaId: mesaEntity.id,
      confirmationId: confirmation.id,
      expiresAt: confirmation.expiresAt,
      message: "Palavra-chave enviada para o WhatsApp do cliente.",
    });
  }

  const mesa = await OcuparMesaService({
    mesaId: mesaEntity.id,
    companyId,
    contactId: resolvedContactId,
    ticketId,
    transferir: !!transferir,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "ocupar",
    mesa,
  });

  return res.status(200).json(mesa);
};

export const confirmarOcupacao = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;
  const { keyword } = req.body;

  const normalizedKeyword = String(keyword || "").trim().toUpperCase();
  if (!normalizedKeyword) {
    throw new AppError("ERR_MESA_KEYWORD_REQUIRED", 400);
  }

  const mesaId = Number(id);
  const confirmation = await MesaOccupationConfirmation.findOne({
    where: {
      mesaId,
      companyId,
      status: "pending",
    },
    order: [["createdAt", "DESC"]],
  });

  if (!confirmation) {
    throw new AppError("ERR_MESA_OCCUPATION_CONFIRMATION_NOT_FOUND", 404);
  }

  if (confirmation.expiresAt && new Date(confirmation.expiresAt).getTime() < Date.now()) {
    await confirmation.update({ status: "expired" });
    throw new AppError("ERR_MESA_OCCUPATION_CONFIRMATION_EXPIRED", 400);
  }

  if (confirmation.keyword !== normalizedKeyword) {
    await confirmation.update({ attempts: (confirmation.attempts || 0) + 1 });
    throw new AppError("ERR_MESA_OCCUPATION_KEYWORD_INVALID", 400);
  }

  const mesa = await OcuparMesaService({
    mesaId,
    companyId,
    contactId: confirmation.contactId,
    ticketId: confirmation.ticketId || undefined,
    transferir: !!confirmation.transferir,
  });

  await confirmation.update({
    status: "confirmed",
    confirmedAt: new Date(),
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "ocupar",
    mesa,
  });

  return res.status(200).json({
    status: "confirmed",
    mesa,
  });
};

export const resumoConta = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const resumo = await ResumoContaMesaService(Number(id), companyId);
  return res.status(200).json(resumo);
};

export const atualizarNomeContato = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;
  const { contactName } = req.body;

  const schema = Yup.object().shape({
    contactName: Yup.string().trim().min(1).required(),
  });

  try {
    await schema.validate({ contactName });
  } catch (err: any) {
    throw new AppError(err.message, 400);
  }

  const mesa = await AtualizarNomeContatoMesaService({
    mesaId: Number(id),
    companyId,
    contactName: String(contactName).trim(),
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "update",
    mesa,
  });

  return res.status(200).json(mesa);
};

export const liberar = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;
  const mesaId = Number(id);
  const { meiosPagamento, desconto } = req.body || {};

  let resumo: { total: number; subtotal: number; mesa?: { number?: string; name?: string } } | null = null;
  try {
    resumo = await ResumoContaMesaService(mesaId, companyId);
  } catch (_) {}

  let financePayload: {
    subtotal: number;
    desconto: number;
    descontoTipo: string | null;
    descontoValor: number | null;
    valor: number;
  } | null = null;

  if (resumo && Number(resumo.subtotal ?? resumo.total) > 0) {
    const subtotalBruto = Number(resumo.subtotal ?? resumo.total);
    const discountResult = applyDiscount(subtotalBruto, desconto);
    financePayload = {
      subtotal: discountResult.subtotal,
      desconto: discountResult.desconto,
      descontoTipo: discountResult.descontoTipo,
      descontoValor: discountResult.descontoValor,
      valor: discountResult.total,
    };

    if (meiosPagamento != null) {
      const payCheck = validatePayments(discountResult.total, meiosPagamento, { requireFullPayment: true });
      if (!payCheck.ok) {
        throw new AppError("ERR_MESA_PAYMENT_MISMATCH", 400);
      }
    }
  }

  const mesa = await LiberarMesaService({
    mesaId,
    companyId,
  });

  if (resumo && financePayload) {
    try {
      await RegisterGourmetVendaService({
        companyId,
        tipo: "mesa",
        valor: financePayload.valor,
        subtotal: financePayload.subtotal,
        desconto: financePayload.desconto,
        descontoTipo: financePayload.descontoTipo,
        descontoValor: financePayload.descontoValor,
        mesaId,
        mesaNumero: resumo.mesa?.number || resumo.mesa?.name || String(mesaId),
        meiosPagamento: meiosPagamento ?? null,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error("RegisterGourmetVendaService (mesa):", err);
    }
  }

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "liberar",
    mesa,
  });

  return res.status(200).json(mesa);
};

export const destroy = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  await DeleteMesaService({
    mesaId: Number(id),
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-mesa`, {
    action: "delete",
    mesaId: Number(id),
  });

  return res.status(200).json({ message: "Mesa removida com sucesso" });
};

/** Lista mesas da empresa para o cardápio público. Não filtra por formId: todas as mesas da empresa. */
export const getPublicMesas = async (req: Request, res: Response): Promise<Response> => {
  setPublicApiNoCacheHeaders(res);
  const { publicId } = req.params as any;

  const form = await findPublicFormBySlug(publicId, {
    attributes: ["companyId"],
  });

  const mesas = await Mesa.findAll({
    where: { companyId: form.companyId },
    order: [
      ["displayOrder", "ASC"],
      ["number", "ASC"],
    ],
    attributes: ["id", "number", "name", "status", "section"],
  });

  return res.json({ mesas });
};

/** Gera link assinado para QR da mesa (mesa independente do formulário). */
export const getMesaLinkQr = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const mesa = await Mesa.findOne({
    where: { id: Number(id), companyId },
    attributes: ["id", "number", "name"],
  });
  if (!mesa) throw new AppError("ERR_MESA_NOT_FOUND", 404);

  const token = signMesaLinkOnly(companyId, mesa.id);
  const base = getFrontendBaseUrl();
  const url = `${base}/mesa/${mesa.id}?t=${token}`;

  return res.json({ url, token });
};

/** Abertura por mesa apenas (URL /mesa/:id?t=). Redireciona para o cardápio correto. Mesas independentes do formulário. */
export const getPublicMesaByToken = async (req: Request, res: Response): Promise<Response> => {
  setPublicApiNoCacheHeaders(res);
  const { mesaId } = req.params;
  const tokenFromQuery = (req.query.t as string) || "";
  const mesaIdNum = Number(mesaId);
  if (!Number.isFinite(mesaIdNum)) throw new AppError("ERR_MESA_NOT_FOUND", 404);

  const mesa = await Mesa.findOne({
    where: { id: mesaIdNum },
    attributes: ["id", "number", "name", "status", "section", "companyId", "formId"],
    include: [
      { association: "contact", attributes: ["id", "name", "number"], required: false },
    ],
  });
  if (!mesa) throw new AppError("ERR_MESA_NOT_FOUND", 404);
  const companyId = mesa.companyId;

  await assertCompanyPublicAccess(companyId);

  if (process.env.MESA_LINK_SECRET) {
    if (!tokenFromQuery || !verifyMesaLinkOnly(companyId, mesaIdNum, tokenFromQuery)) {
      throw new AppError("ERR_MESA_LINK_INVALID", 403);
    }
  }

  let form: Form | null = null;
  if (mesa.formId) {
    form = await Form.findOne({
      where: { id: mesa.formId, companyId, isActive: true },
      attributes: ["id", "slug", "publicId", "companyId"],
    });
    if (!form) {
      throw new AppError(
        "Formulário vinculado a esta mesa não está disponível. Atualize o vínculo da mesa ou reative o formulário.",
        404
      );
    }
  }
  if (!form) {
    form = await GetOrCreateDefaultCardapioFormService({ companyId });
  }

  const plain = mesa.get({ plain: true }) as any;
  const orderToken = createOrderToken(form.id, mesa.id);
  return res.json({
    formPublicId: (form as any).publicId,
    formId: form.id,
    mesa: {
      id: plain.id,
      number: plain.number,
      name: plain.name,
      status: plain.status,
      section: plain.section,
      contact: plain.contact ? { name: plain.contact.name, number: plain.contact.number } : null,
    },
    orderToken,
  });
};

/** Produtos de cardápio da empresa para o link da mesa (com variações e addOnGroup como no formulário público). */
export const getPublicMesaProducts = async (req: Request, res: Response): Promise<Response> => {
  setPublicApiNoCacheHeaders(res);
  const { mesaId } = req.params;
  const tokenFromQuery = (req.query.t as string) || "";
  const mesaIdNum = Number(mesaId);
  if (!Number.isFinite(mesaIdNum)) throw new AppError("ERR_MESA_NOT_FOUND", 404);

  const mesa = await Mesa.findOne({
    where: { id: mesaIdNum },
    attributes: ["id", "companyId"],
  });
  if (!mesa) throw new AppError("ERR_MESA_NOT_FOUND", 404);
  const companyId = mesa.companyId;

  await assertCompanyPublicAccess(companyId);

  if (process.env.MESA_LINK_SECRET) {
    if (!tokenFromQuery || !verifyMesaLinkOnly(companyId, mesaIdNum, tokenFromQuery)) {
      throw new AppError("ERR_MESA_LINK_INVALID", 403);
    }
  }

  const products = await Product.findAll({
    where: { companyId, isMenuProduct: true },
    order: [["grupo", "ASC"], ["name", "ASC"]],
    attributes: ["id", "name", "description", "value", "grupo", "isMenuProduct", "variablePrice", "imageUrl", "allowsHalfAndHalf", "halfAndHalfPriceRule", "halfAndHalfGrupo", "addOnGroupId"],
    include: [
      { association: "variations", include: [{ association: "options" }] },
    ],
  });

  const grupoAssignments = await GrupoAddOn.findAll({
    where: { companyId },
    attributes: ["grupo", "addOnGroupId"],
  });
  const grupoToAddOnId = new Map(grupoAssignments.map((a) => [a.grupo, a.addOnGroupId]));

  const addOnGroupIds = new Set<number>();
  products.forEach((p) => {
    const resolved = p.addOnGroupId ?? (p.grupo ? grupoToAddOnId.get(p.grupo) : undefined);
    if (resolved) addOnGroupIds.add(resolved);
  });

  const addOnGroupsRaw = await AddOnGroup.findAll({
    where: { id: Array.from(addOnGroupIds), companyId },
    include: [
      { model: AddOnSubgroup, as: "subgroups", include: [{ model: AddOnItem, as: "items" }] },
      { model: AddOnItem, as: "items" },
    ],
  });

  const addOnGroupMap = new Map(
    addOnGroupsRaw.map((g) => {
      const subs = (g.subgroups || []).slice().sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
      const subgroups = subs.map((sg: any) => ({
        id: sg.id,
        name: sg.name,
        order: sg.order,
        items: (sg.items || []).slice().sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)).map((it: any) => ({ id: it.id, label: it.label, value: Number(it.value), order: it.order })),
      }));
      const rootItems = (g.items || []).filter((it: any) => !it.addOnSubgroupId).sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)).map((it: any) => ({ id: it.id, label: it.label, value: Number(it.value), order: it.order }));
      return [
        g.id,
        { id: g.id, name: g.name, subgroups, items: rootItems },
      ];
    })
  );

  const productsWithAddOn = products.map((p) => {
    const po = p.toJSON() as Record<string, unknown> & { addOnGroupId?: number | null; grupo?: string };
    const resolvedAddOnId = po.addOnGroupId ?? (po.grupo ? grupoToAddOnId.get(po.grupo) : undefined);
    po.addOnGroup = resolvedAddOnId ? addOnGroupMap.get(resolvedAddOnId) ?? null : null;
    return po;
  });

  return res.json({ products: productsWithAddOn, count: productsWithAddOn.length });
};

/** Mesa por ID para cardápio público (QR da mesa): exige token assinado (t=); retorna orderToken para o submit.
 * Aceita token só-mesa (verifyMesaLinkOnly) ou token form+mesa (verifyMesaLink) para compatibilidade. */
export const getPublicMesaById = async (req: Request, res: Response): Promise<Response> => {
  setPublicApiNoCacheHeaders(res);
  const { publicId, mesaId } = req.params as any;
  const tokenFromQuery = (req.query.t as string) || "";

  const form = await findPublicFormBySlug(publicId, {
    attributes: ["id", "companyId"],
  });

  const mesaIdNum = Number(mesaId);
  if (!Number.isFinite(mesaIdNum)) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  if (tokenFromQuery && process.env.MESA_LINK_SECRET) {
    const validByForm = verifyMesaLink(publicId, mesaIdNum, tokenFromQuery);
    const validByMesaOnly = verifyMesaLinkOnly(form.companyId, mesaIdNum, tokenFromQuery);
    if (!validByForm && !validByMesaOnly) {
      throw new AppError("ERR_MESA_LINK_INVALID", 403);
    }
  }

  const mesa = await Mesa.findOne({
    where: {
      id: mesaIdNum,
      companyId: form.companyId,
    },
    include: [
      { association: "contact", attributes: ["id", "name", "number"], required: false },
    ],
    attributes: ["id", "number", "name", "status", "section"],
  });

  if (!mesa) {
    throw new AppError("ERR_MESA_NOT_FOUND", 404);
  }

  const plain = mesa.get({ plain: true }) as any;
  const orderToken = createOrderToken(form.id, mesa.id);
  const payload = {
    id: plain.id,
    number: plain.number,
    name: plain.name,
    status: plain.status,
    section: plain.section,
    contact: plain.contact ? { name: plain.contact.name, number: plain.contact.number } : null,
    orderToken,
  };

  return res.json(payload);
};

/** Retorna o formulário cardápio padrão da empresa (obtido ou criado). Usado pelo painel quando a mesa não tem cardápio vinculado. */
export const getDefaultCardapioForm = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const createdBy = parseInt(req.user.id);
  const form = await GetOrCreateDefaultCardapioFormService({ companyId, createdBy });
  const plain = form.get({ plain: true }) as any;
  return res.json({
    formId: plain.id,
    publicId: plain.publicId,
    slug: plain.slug,
    name: plain.name,
  });
};
