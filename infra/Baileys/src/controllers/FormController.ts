import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import { Op } from "sequelize";

import Form from "../models/Form";
import FormField from "../models/FormField";
import FormResponse from "../models/FormResponse";
import Contact from "../models/Contact";
import Company from "../models/Company";
import Setting from "../models/Setting";
import CreateFormService from "../services/FormServices/CreateFormService";
import UpdateFormService from "../services/FormServices/UpdateFormService";
import DeleteFormService from "../services/FormServices/DeleteFormService";
import AppError from "../errors/AppError";
import { normalizeBrazilPhoneForWhatsapp } from "../helpers/NormalizeBrazilPhone";
import { setPublicApiNoCacheHeaders } from "../helpers/setPublicApiNoCacheHeaders";
import { findPublicFormBySlug } from "../services/FormServices/FindPublicFormService";
import {
  decodePieceAgainValue,
  filterPieceAgainPrefillByLabel,
  resolvePieceAgainStoredFieldIds,
} from "../helpers/pieceAgainFields";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { searchParam, pageNumber, formType } = req.query;

  const whereCondition: any = { companyId };
  
  if (searchParam) {
    whereCondition.name = {
      [Op.iLike]: `%${searchParam}%`
    };
  }

  const isCardapioOnly = formType === "cardapio";
  const isAgendamentoOnly = formType === "agendamento";
  const limit = isCardapioOnly || isAgendamentoOnly ? 100 : 20;
  const offset = pageNumber ? (Number(pageNumber) - 1) * limit : 0;

  const findOptions: any = {
    where: whereCondition,
    include: [
      {
        association: "fields",
        separate: true,
        order: [["order", "ASC"]],
      },
      {
        association: "responses",
        attributes: ["id"],
        required: false,
      },
    ],
    limit,
    offset,
    order: [["createdAt", "DESC"]],
  };
  const { count, rows: formsRaw } = await Form.findAndCountAll(findOptions);
  const forms = isCardapioOnly
    ? formsRaw.filter((f) => (f.settings as any)?.formType === "cardapio")
    : isAgendamentoOnly
    ? formsRaw.filter((f) => (f.settings as any)?.formType === "agendamento")
    : formsRaw;

  const formsWithStats = forms.map((form) => {
    const formData: any = form.toJSON();
    // Sort fields by order manually if needed
    if (formData.fields) {
      formData.fields.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    }
    return {
      ...formData,
      responseCount: formData.responses?.length || 0,
    };
  });

  return res.json({
    forms: formsWithStats,
    count: isCardapioOnly || isAgendamentoOnly ? formsWithStats.length : count,
    hasMore: isCardapioOnly || isAgendamentoOnly ? false : count > offset + limit,
  });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  // Validate that id is a number
  const formId = Number(id);
  if (isNaN(formId)) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const form = await Form.findOne({
    where: { id: formId, companyId },
    include: [
      {
        association: "fields",
        separate: true,
        order: [["order", "ASC"]],
      },
      {
        association: "creator",
        attributes: ["id", "name"],
      },
    ],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const formData: any = form.toJSON();
  // Sort fields by order manually if needed
  if (formData.fields) {
    formData.fields.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  }

  return res.json(formData);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const data = req.body;

  const schema = Yup.object().shape({
    name: Yup.string().required(),
    fields: Yup.array().of(
      Yup.object().shape({
        label: Yup.string().required(),
        fieldType: Yup.string().required(),
        order: Yup.number().required(),
      })
    ).nullable(),
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const form = await CreateFormService({
    ...data,
    companyId,
    createdBy: userId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-form`, {
    action: "create",
    form,
  });

  return res.status(200).json(form);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;
  const data = req.body;

  const form = await UpdateFormService({
    formId: Number(id),
    companyId,
    ...data,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-form`, {
    action: "update",
    form,
  });

  return res.status(200).json(form);
};

export const destroy = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  await DeleteFormService({
    formId: Number(id),
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-form`, {
    action: "delete",
    formId: Number(id),
  });

  return res.status(200).json({ message: "Form deleted successfully" });
};

export const duplicate = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId, id: userId } = req.user;

  const originalForm = await Form.findOne({
    where: { id, companyId },
    include: [{ association: "fields" }],
  });

  if (!originalForm) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const formData: any = originalForm.toJSON();
  delete formData.id;
  delete formData.createdAt;
  delete formData.updatedAt;
  delete formData.slug;

  const newForm = await CreateFormService({
    ...formData,
    name: `${formData.name} (Cópia)`,
    companyId,
    createdBy: Number(userId) || 0,
    fields: formData.fields?.map((f: any) => {
      const fieldData = { ...f };
      delete fieldData.id;
      delete fieldData.formId;
      delete fieldData.createdAt;
      delete fieldData.updatedAt;
      return fieldData;
    }) || [],
  });

  return res.status(200).json(newForm);
};

export const getPublicForm = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { publicId } = req.params as any;

  console.log(`[PublicForm] Buscando formulário com publicId: ${publicId}`);

  const form = await findPublicFormBySlug(publicId, {
    include: [
      {
        association: "fields",
        separate: true,
        order: [["order", "ASC"]],
      },
    ],
  });

  const formData: any = form.toJSON();
  console.log(`[PublicForm] Formulário encontrado: ${formData.name} (${formData.fields?.length || 0} campos)`);

  setPublicApiNoCacheHeaders(res);
  
  // Se for formulário de agendamento, incluir horários da empresa se scheduleType for "company"
  const formSettings = formData.settings || {};
  if (formSettings.formType === "agendamento") {
    const scheduleTypeSetting = await Setting.findOne({
      where: { companyId: form.companyId, key: "scheduleType" },
    });
    const scheduleType = scheduleTypeSetting?.value || "disabled";
    
    if (scheduleType === "company") {
      const company = await Company.findByPk(form.companyId, {
        attributes: ["schedules"],
      });
      if (company?.schedules) {
        formData.companySchedules = company.schedules;
      }
    }
    formData.scheduleType = scheduleType;
  }
  
  return res.json(formData);
};

export const getStats = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const form = await Form.findOne({
    where: { id, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const responseCount = await FormResponse.count({
    where: { formId: form.id },
  });

  return res.json({
    formId: form.id,
    responseCount,
  });
};

/** Export form as JSON template (without ids, companyId, etc.) */
export const exportForm = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const form = await Form.findOne({
    where: { id: Number(id), companyId },
    include: [{ association: "fields", order: [["order", "ASC"]] }],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const formData: any = form.toJSON();
  const exportData = {
    name: formData.name,
    description: formData.description,
    primaryColor: formData.primaryColor,
    secondaryColor: formData.secondaryColor,
    logoPosition: formData.logoPosition,
    logoUrl: formData.logoUrl,
    successMessage: formData.successMessage,
    successRedirectUrl: formData.successRedirectUrl,
    requireAuth: formData.requireAuth,
    allowMultipleSubmissions: formData.allowMultipleSubmissions,
    isAnonymous: formData.isAnonymous,
    createContact: formData.createContact,
    createTicket: formData.createTicket,
    sendWebhook: formData.sendWebhook,
    webhookUrl: formData.webhookUrl,
    settings: formData.settings,
    fields: (formData.fields || []).map((f: any) => {
      const { id: _id, formId: _formId, createdAt: _c, updatedAt: _u, ...field } = f;
      return field;
    }),
    exportedAt: new Date().toISOString(),
    version: 1,
  };

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="form-${formData.name.replace(/[^a-z0-9]/gi, "-")}.json"`);
  return res.json(exportData);
};

/** Import form from JSON template */
export const importForm = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const data = req.body;

  if (!data || !data.name) {
    throw new AppError("ERR_FORM_IMPORT_INVALID", 400);
  }

  const form = await CreateFormService({
    name: data.name,
    description: data.description,
    companyId,
    createdBy: Number(userId),
    isImport: true,
    primaryColor: data.primaryColor,
    secondaryColor: data.secondaryColor,
    logoPosition: data.logoPosition,
    logoUrl: data.logoUrl,
    successMessage: data.successMessage,
    successRedirectUrl: data.successRedirectUrl,
    requireAuth: data.requireAuth,
    allowMultipleSubmissions: data.allowMultipleSubmissions,
    isAnonymous: data.isAnonymous,
    createContact: data.createContact,
    createTicket: data.createTicket,
    sendWebhook: data.sendWebhook,
    webhookUrl: data.webhookUrl,
    settings: data.settings,
    fields: data.fields || [],
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-form`, {
    action: "create",
    form,
  });

  return res.status(201).json(form);
};

/** Upload logo do formulário (imagem). Retorna a URL da logo. */
export const uploadLogo = async (req: Request, res: Response): Promise<Response> => {
  const file = req.file as Express.Multer.File;
  if (!file || !file.filename) {
    throw new AppError("Selecione uma imagem para a logo (JPEG, PNG, GIF ou WEBP).", 400);
  }
  const baseUrl = process.env.BACKEND_URL || "http://localhost:3333";
  const logoUrl = `${baseUrl.replace(/\/$/, "")}/public/form-logos/${file.filename}`;
  return res.json({ logoUrl });
};

/** GET /public/forms/:slug/most-ordered - Retorna IDs dos produtos mais pedidos (para seção "Os mais pedidos"). */
export const getPublicMostOrdered = async (req: Request, res: Response): Promise<Response> => {
  setPublicApiNoCacheHeaders(res);
  const { publicId } = req.params as any;
  const form = await findPublicFormBySlug(publicId, {
    attributes: ["id"],
  });
  const responses = await FormResponse.findAll({
    where: { formId: form.id },
    attributes: ["metadata"],
  });
  const countByProduct: Record<number, number> = {};
  responses.forEach((r) => {
    const meta = (r.metadata || {}) as { menuItems?: Array<{ productId: number; quantity?: number }> };
    const items = meta.menuItems || [];
    items.forEach((item) => {
      const id = item.productId;
      if (id) {
        countByProduct[id] = (countByProduct[id] || 0) + (item.quantity || 1);
      }
    });
  });
  const productIds = Object.entries(countByProduct)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([id]) => Number(id));
  return res.json({ productIds });
};

/** GET /public/forms/:slug/repeat-data?phone=... - Retorna dados para "Peça de novo" e pré-preenchimento por telefone. */
export const getPublicRepeatData = async (req: Request, res: Response): Promise<Response> => {
  setPublicApiNoCacheHeaders(res);
  const { publicId } = req.params as any;
  const phoneRaw = String((req.query as any)?.phone || "");
  if (!phoneRaw || phoneRaw.trim() === "") {
    throw new AppError("Informe o telefone para buscar seu histórico.", 400);
  }

  const normalizePhone = (input: string) => {
    return normalizeBrazilPhoneForWhatsapp(input);
  };

  const phoneNormalized = normalizePhone(phoneRaw);
  if (!phoneNormalized || phoneNormalized.length < 10) {
    throw new AppError("Telefone inválido. Informe DDD e número.", 400);
  }

  const form = await findPublicFormBySlug(publicId, {
    attributes: ["id", "companyId", "settings"],
    include: [{ association: "fields", order: [["order", "ASC"]] }],
  });

  const settings = (form.settings as any) || {};
  const fields = (form.fields || []) as any[];
  const storedFieldIds = resolvePieceAgainStoredFieldIds(settings, fields);
  const maxOrders = Math.min(30, Math.max(1, Number(settings.pieceAgainMaxOrders ?? 5) || 5));
  const maxItems = Math.min(50, Math.max(1, Number(settings.pieceAgainMaxItems ?? 6) || 6));

  const contact = await Contact.findOne({
    where: { number: phoneNormalized, companyId: form.companyId },
    include: ["extraInfo"],
  });

  const decodeMaybeJson = decodePieceAgainValue;

  // Montar prefillByLabel a partir dos ContactCustomFields (name=label do campo).
  const prefillRaw: Record<string, any> = {};
  if (contact && Array.isArray((contact as any).extraInfo)) {
    (contact as any).extraInfo.forEach((info: any) => {
      if (info?.name && info?.value != null && String(info.value).trim() !== "") {
        prefillRaw[String(info.name)] = decodeMaybeJson(info.value);
      }
    });
  }
  const prefillByLabel = filterPieceAgainPrefillByLabel(
    prefillRaw,
    fields,
    storedFieldIds
  );

  const responses = await FormResponse.findAll({
    where: { formId: form.id, responderPhone: phoneNormalized },
    attributes: ["metadata", "submittedAt"],
    order: [["submittedAt", "DESC"]],
    limit: maxOrders,
  });

  // Estrutura para armazenar produtos com suas variações mais frequentes
  interface ProductRepeatData {
    productId: number;
    count: number;
    variationOptionId?: number; // Variação mais frequente
    isHalfAndHalf?: boolean; // Se é meio a meio
    half1ProductId?: number;
    half2ProductId?: number;
    half1OptionId?: number;
    half2OptionId?: number;
  }

  const productDataMap: Record<number, ProductRepeatData> = {};
  const variationCountMap: Record<string, number> = {}; // "productId_optionId" -> count
  const halfAndHalfCountMap: Record<string, number> = {}; // "baseId_half1Id_half2Id" -> count

  responses.forEach((r) => {
    const meta = (r.metadata || {}) as any;
    const items = Array.isArray(meta.menuItems) ? meta.menuItems : [];
    items.forEach((item: any) => {
      const id = Number(item?.productId);
      if (!id) return;
      const qty = Number(item?.quantity || 1) || 1;

      // Contar produto simples
      if (!productDataMap[id]) {
        productDataMap[id] = { productId: id, count: 0 };
      }
      productDataMap[id].count += qty;

      // Se tem variação, contar a variação específica
      if (item.variationOptionId) {
        const varKey = `${id}_${item.variationOptionId}`;
        variationCountMap[varKey] = (variationCountMap[varKey] || 0) + qty;
      }

      // Se é meio a meio, contar a combinação
      if (item.type === "halfAndHalf" && item.half1ProductId && item.half2ProductId) {
        const halfKey = `${id}_${item.half1ProductId}_${item.half2ProductId}_${item.half1OptionId || 0}_${item.half2OptionId || 0}`;
        halfAndHalfCountMap[halfKey] = (halfAndHalfCountMap[halfKey] || 0) + qty;
      }
    });
  });

  // Determinar a variação mais frequente para cada produto
  Object.keys(variationCountMap).forEach((key) => {
    const [productIdStr, optionIdStr] = key.split("_");
    const productId = Number(productIdStr);
    const optionId = Number(optionIdStr);
    if (productDataMap[productId]) {
      const currentVarKey = productDataMap[productId].variationOptionId
        ? `${productId}_${productDataMap[productId].variationOptionId}`
        : null;
      const currentCount = currentVarKey ? variationCountMap[currentVarKey] || 0 : 0;
      if (variationCountMap[key] > currentCount) {
        productDataMap[productId].variationOptionId = optionId;
      }
    }
  });

  // Determinar a combinação meio a meio mais frequente
  let mostFrequentHalfAndHalf: { baseId: number; half1Id: number; half2Id: number; half1OptionId?: number; half2OptionId?: number; count: number } | null = null;
  Object.entries(halfAndHalfCountMap).forEach(([key, count]) => {
    const parts = key.split("_");
    if (parts.length >= 3) {
      const baseId = Number(parts[0]);
      const half1Id = Number(parts[1]);
      const half2Id = Number(parts[2]);
      const half1OptionId = parts[3] ? Number(parts[3]) : undefined;
      const half2OptionId = parts[4] ? Number(parts[4]) : undefined;
      if (!mostFrequentHalfAndHalf || count > mostFrequentHalfAndHalf.count) {
        mostFrequentHalfAndHalf = { baseId, half1Id, half2Id, half1OptionId, half2OptionId, count };
      }
    }
  });

  const productData = Object.values(productDataMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, maxItems);

  return res.json({
    phoneNormalized,
    contactName: contact?.name || "",
    productIds: productData.map((p) => p.productId),
    productData: productData.map((p) => ({
      productId: p.productId,
      variationOptionId: p.variationOptionId,
    })),
    mostFrequentHalfAndHalf: mostFrequentHalfAndHalf ? {
      baseProductId: mostFrequentHalfAndHalf.baseId,
      half1ProductId: mostFrequentHalfAndHalf.half1Id,
      half2ProductId: mostFrequentHalfAndHalf.half2Id,
      half1OptionId: mostFrequentHalfAndHalf.half1OptionId,
      half2OptionId: mostFrequentHalfAndHalf.half2OptionId,
    } : null,
    prefillByLabel,
  });
};
