import { Request, Response } from "express";
import { Op, Sequelize } from "sequelize";
import { getIO } from "../libs/socket";
import XLSX from "xlsx";

import Form from "../models/Form";
import FormResponse from "../models/FormResponse";
import ResponseAnswer from "../models/ResponseAnswer";
import ProcessFormResponseService from "../services/FormServices/ProcessFormResponseService";
import UpdateOrderStatusService from "../services/OrderServices/UpdateOrderStatusService";
import { ReprintLastPrintJobForFormResponse } from "../services/PrintJobService/ReprintPrintJobService";
import UpdateDeliveryOrderService from "../services/OrderServices/UpdateDeliveryOrderService";
import AppError from "../errors/AppError";
import { verifyOrderToken, verifyOrderTrackingToken } from "../helpers/MesaLinkSign";
import {
  findPublicFormById,
  findPublicFormBySlug,
} from "../services/FormServices/FindPublicFormService";

const RESPONSES_MAX_AGE_HOURS = 24;

const getResponsesCutoff = (): Date =>
  new Date(Date.now() - RESPONSES_MAX_AGE_HOURS * 60 * 60 * 1000);

export const listOrders = async (req: Request, res: Response): Promise<Response> => {
  const { formId } = req.params;
  const { companyId } = req.user;
  const { dateFrom, dateTo, orderStatus, search, orderType, tableId } = req.query;

  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const formSettings = form.settings as any;
  if (formSettings?.formType !== "cardapio") {
    throw new AppError("ERR_FORM_NOT_MENU", 400);
  }

  const whereCondition: any = { formId: Number(formId) };
  if (dateFrom || dateTo) {
    const dateRange: any = {};
    if (dateFrom) dateRange[Op.gte] = new Date(String(dateFrom));
    if (dateTo) dateRange[Op.lte] = new Date(String(dateTo));
    whereCondition.submittedAt = dateRange;
  } else {
    whereCondition.submittedAt = { [Op.gte]: getResponsesCutoff() } as any;
  }
  if (orderStatus && typeof orderStatus === "string") {
    whereCondition.orderStatus = orderStatus;
  } else {
    whereCondition[Op.and] = whereCondition[Op.and] || [];
    whereCondition[Op.and].push({
      [Op.or]: [{ orderStatus: { [Op.ne]: "faturado" } }, { orderStatus: null }],
    });
  }
  if (search && typeof search === "string" && search.trim()) {
    const searchTerm = `%${search.trim()}%`;
    whereCondition[Op.or] = [
      { responderName: { [Op.like]: searchTerm } },
      { responderPhone: { [Op.like]: searchTerm } },
      { responderEmail: { [Op.like]: searchTerm } },
    ];
  }
  if (orderType === "delivery") {
    whereCondition[Op.and] = whereCondition[Op.and] || [];
    whereCondition[Op.and].push(
      Sequelize.literal("metadata->>'orderType' = 'delivery'")
    );
  } else if (orderType === "mesa") {
    whereCondition[Op.and] = whereCondition[Op.and] || [];
    whereCondition[Op.and].push(
      Sequelize.literal("(metadata->>'orderType' IS NULL OR metadata->>'orderType' = 'mesa')")
    );
  }
  const replacements: Record<string, string> = {};
  if (tableId != null && String(tableId).trim() !== "") {
    const tid = String(tableId).trim();
    whereCondition[Op.and] = whereCondition[Op.and] || [];
    whereCondition[Op.and].push(Sequelize.literal("metadata->>'tableId' = :tableId"));
    replacements.tableId = tid;
  }

  const responses = await FormResponse.findAll({
    where: whereCondition,
    replacements: Object.keys(replacements).length ? replacements : undefined,
    include: [
      { association: "answers", include: [{ association: "field" }] },
      { association: "contact", attributes: ["id", "name", "number", "email"] },
      { association: "ticket", attributes: ["id", "status"] },
    ],
    order: [["submittedAt", "DESC"]],
    limit: 500,
  });

  return res.json({ orders: responses });
};

const isCardapioForm = (form: Form): boolean => {
  try {
    const s = form.settings;
    const settings = typeof s === "string" ? JSON.parse(s || "{}") : (s || {});
    return (settings as any)?.formType === "cardapio";
  } catch {
    return false;
  }
};

export const listAllOrders = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { dateFrom, dateTo, orderStatus, search, formId: formIdFilter, orderType, tableId } = req.query;

  const allForms = await Form.findAll({
    where: { companyId },
    attributes: ["id", "name", "settings"],
  });
  const cardapioForms = allForms.filter(isCardapioForm);
  const cardapioFormIds = cardapioForms.map((f) => f.id);

  if (cardapioFormIds.length === 0) {
    return res.json({ orders: [], forms: [] });
  }

  const whereCondition: any = { formId: { [Op.in]: cardapioFormIds } };
  if (formIdFilter && typeof formIdFilter === "string") {
    const fid = Number(formIdFilter);
    if (cardapioFormIds.includes(fid)) {
      whereCondition.formId = fid;
    }
  }
  if (dateFrom || dateTo) {
    const dateRange: any = {};
    if (dateFrom) dateRange[Op.gte] = new Date(String(dateFrom));
    if (dateTo) dateRange[Op.lte] = new Date(String(dateTo));
    whereCondition.submittedAt = dateRange;
  } else {
    whereCondition.submittedAt = { [Op.gte]: getResponsesCutoff() } as any;
  }
  if (orderStatus && typeof orderStatus === "string") {
    whereCondition.orderStatus = orderStatus;
  } else {
    whereCondition[Op.and] = whereCondition[Op.and] || [];
    whereCondition[Op.and].push({
      [Op.or]: [{ orderStatus: { [Op.ne]: "faturado" } }, { orderStatus: null }],
    });
  }
  if (search && typeof search === "string" && search.trim()) {
    const searchTerm = `%${search.trim()}%`;
    whereCondition[Op.or] = [
      { responderName: { [Op.like]: searchTerm } },
      { responderPhone: { [Op.like]: searchTerm } },
      { responderEmail: { [Op.like]: searchTerm } },
    ];
  }
  if (orderType === "delivery") {
    whereCondition[Op.and] = whereCondition[Op.and] || [];
    whereCondition[Op.and].push(
      Sequelize.literal("metadata->>'orderType' = 'delivery'")
    );
  } else if (orderType === "mesa") {
    whereCondition[Op.and] = whereCondition[Op.and] || [];
    whereCondition[Op.and].push(
      Sequelize.literal("(metadata->>'orderType' IS NULL OR metadata->>'orderType' = 'mesa')")
    );
  }
  const replacements: Record<string, string> = {};
  if (tableId != null && String(tableId).trim() !== "") {
    const tid = String(tableId).trim();
    whereCondition[Op.and] = whereCondition[Op.and] || [];
    whereCondition[Op.and].push(Sequelize.literal("metadata->>'tableId' = :tableId"));
    replacements.tableId = tid;
  }

  const responses = await FormResponse.findAll({
    where: whereCondition,
    replacements: Object.keys(replacements).length ? replacements : undefined,
    include: [
      { association: "answers", include: [{ association: "field" }] },
      { association: "contact", attributes: ["id", "name", "number", "email"] },
      { association: "ticket", attributes: ["id", "status"] },
      { association: "form", attributes: ["id", "name", "settings"] },
    ],
    order: [["submittedAt", "DESC"]],
    limit: 500,
  });

  return res.json({
    orders: responses,
    forms: cardapioForms.map((f) => ({ id: f.id, name: f.name })),
  });
};

export const unconfirmedOrderCounts = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;

  const allForms = await Form.findAll({
    where: { companyId },
    attributes: ["id", "settings"],
  });
  const cardapioForms = allForms.filter(isCardapioForm);
  const cardapioFormIds = cardapioForms.map((f) => f.id);

  if (cardapioFormIds.length === 0) {
    return res.json({ mesa: 0, delivery: 0 });
  }

  // Badge = pedidos ainda em status "novo" (ao sair para qualquer outro status, o badge deve atualizar)
  const baseWhere: any = {
    formId: { [Op.in]: cardapioFormIds },
    [Op.or]: [{ orderStatus: "novo" }, { orderStatus: null }],
    submittedAt: { [Op.gte]: getResponsesCutoff() } as any,
  };

  const [mesa, delivery] = await Promise.all([
    FormResponse.count({
      where: {
        ...baseWhere,
        [Op.and]: [Sequelize.literal("(metadata->>'orderType' IS NULL OR metadata->>'orderType' = 'mesa')")],
      },
    }),
    FormResponse.count({
      where: {
        ...baseWhere,
        [Op.and]: [Sequelize.literal("metadata->>'orderType' = 'delivery'")],
      },
    }),
  ]);

  return res.json({ mesa, delivery });
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { formId } = req.params;
  const { companyId } = req.user;
  const { pageNumber, isRead, isStarred } = req.query;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const whereCondition: any = {
    formId: Number(formId),
    submittedAt: { [Op.gte]: getResponsesCutoff() } as any,
  };

  if (isRead !== undefined) {
    whereCondition.isRead = isRead === "true";
  }

  if (isStarred !== undefined) {
    whereCondition.isStarred = isStarred === "true";
  }

  const limit = 20;
  const offset = pageNumber ? (Number(pageNumber) - 1) * limit : 0;

  const { count, rows: responses } = await FormResponse.findAndCountAll({
    where: whereCondition,
    include: [
      {
        association: "answers",
        include: [{ association: "field" }],
      },
      {
        association: "contact",
        attributes: ["id", "name", "number", "email"],
      },
      {
        association: "ticket",
        attributes: ["id", "status"],
      },
    ],
    limit,
    offset,
    order: [["submittedAt", "DESC"]],
  });

  return res.json({
    responses,
    count,
    hasMore: count > offset + limit,
  });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { formId, id } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const response = await FormResponse.findOne({
    where: { id, formId },
    include: [
      {
        association: "answers",
        include: [{ association: "field" }],
      },
      {
        association: "contact",
      },
      {
        association: "ticket",
      },
      {
        association: "form",
      },
    ],
  });

  if (!response) {
    throw new AppError("ERR_RESPONSE_NOT_FOUND", 404);
  }

  return res.json(response);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { publicId } = req.params as any;
  const data = req.body;

  // Get form by slug (public endpoint)
  // Se houver orderToken, verificar e usar o formId do token (garante que pedido de mesa use o formulário correto)
  let formIdToUse: number | null = null;
  if (data.orderToken) {
    const decoded = verifyOrderToken(data.orderToken);
    if (decoded && decoded.formId) {
      formIdToUse = decoded.formId;
      console.log(`FormResponseController: Using formId from orderToken: ${formIdToUse} (publicId received: ${publicId})`);
    }
  }

  // Buscar formulário pelo slug ou pelo formId do orderToken
  const form = formIdToUse
    ? await findPublicFormById(formIdToUse)
    : await findPublicFormBySlug(publicId);

  // Se orderToken foi fornecido, validar que o formId corresponde
  if (data.orderToken && formIdToUse && form.id !== formIdToUse) {
    throw new AppError("ERR_MESA_LINK_INVALID", 403);
  }

  const ipAddress = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
  const userAgent = req.headers["user-agent"] || "";

  console.log(`FormResponseController: Processing response for formId=${form.id}, publicId=${publicId}, hasOrderToken=${!!data.orderToken}`);

  const userCompanyId = (req as any).user?.companyId;
  const orderHoursBypass =
    userCompanyId != null && Number(userCompanyId) === Number(form.companyId);

  const response = await ProcessFormResponseService({
    formId: form.id,
    ...data,
    orderToken: data.orderToken,
    ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress,
    userAgent,
    orderHoursBypass,
  });

  const io = getIO();
  io.to(`company-${form.companyId}-mainchannel`).emit(`company-${form.companyId}-formResponse`, {
    action: "create",
    response,
  });

  const payload = response.get ? response.get({ plain: true }) : response;
  const body = {
    ...payload,
    whatsappSent: (response as any).whatsappSent,
    whatsappError: (response as any).whatsappError,
    trackingToken: (response as any).trackingToken,
  };
  return res.status(200).json(body);
};

/** Público: status do pedido para a página de acompanhamento (/pedido/:token). */
export const getPublicOrderStatus = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { token } = req.params as any;
  const decoded = verifyOrderTrackingToken(String(token || ""));
  if (!decoded) {
    throw new AppError("ERR_ORDER_TRACKING_INVALID", 404);
  }

  const response = await FormResponse.findOne({
    where: { id: decoded.formResponseId, formId: decoded.formId },
    attributes: ["id", "protocol", "orderStatus", "submittedAt", "metadata"],
    include: [
      {
        model: Form,
        as: "form",
        required: true,
        where: { companyId: decoded.companyId },
        attributes: ["id", "name", "settings", "primaryColor", "logoUrl"],
      },
    ],
  });

  if (!response) {
    throw new AppError("ERR_ORDER_NOT_FOUND", 404);
  }

  const meta = (response.metadata || {}) as any;
  const formSettings = ((response as any).form?.settings || {}) as any;
  const items = Array.isArray(meta.menuItems)
    ? meta.menuItems.map((it: any) => ({
        productName: it.productName || "Item",
        quantity: it.quantity || 1,
        productValue: Number(it.productValue) || 0,
        addonsTotal: Number(it.addonsTotal) || 0,
        addons: Array.isArray(it.addons)
          ? it.addons.map((a: any) => ({ label: a.label, value: Number(a.value) || 0 }))
          : [],
        observation: it.observation || "",
      }))
    : [];

  return res.json({
    protocol: response.protocol,
    orderStatus: response.orderStatus || "novo",
    submittedAt: response.submittedAt,
    orderType: meta.orderType || null,
    tableNumber: meta.tableNumber || null,
    subtotal: meta.subtotal != null ? Number(meta.subtotal) : null,
    deliveryFee: meta.deliveryFee != null ? Number(meta.deliveryFee) : null,
    couponCode: meta.couponCode || null,
    couponDiscount: meta.couponDiscount != null ? Number(meta.couponDiscount) : null,
    total: meta.total != null ? Number(meta.total) : null,
    items,
    storeName: (response as any).form?.name || "",
    primaryColor: (response as any).form?.primaryColor || null,
    logoUrl: (response as any).form?.logoUrl || null,
    averageDeliveryTime: formSettings.averageDeliveryTime || "",
  });
};

export const destroy = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { formId, id } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const response = await FormResponse.findOne({
    where: { id, formId },
  });

  if (!response) {
    throw new AppError("ERR_RESPONSE_NOT_FOUND", 404);
  }

  await response.destroy();

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-formResponse`, {
    action: "delete",
    responseId: Number(id),
  });

  return res.status(200).json({ message: "Response deleted successfully" });
};

export const markAsRead = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { formId, id } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const response = await FormResponse.findOne({
    where: { id, formId },
  });

  if (!response) {
    throw new AppError("ERR_RESPONSE_NOT_FOUND", 404);
  }

  await response.update({ isRead: true });

  return res.status(200).json(response);
};

export const updateOrderStatus = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { formId, id } = req.params;
  const { orderStatus } = req.body;
  const { companyId } = req.user;

  if (!orderStatus || typeof orderStatus !== "string") {
    throw new AppError("ERR_ORDER_STATUS_REQUIRED", 400);
  }

  const response = await UpdateOrderStatusService({
    formId: Number(formId),
    responseId: Number(id),
    orderStatus,
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-formResponse`, {
    action: "update",
    response,
  });

  return res.status(200).json(response);
};

export const toggleStar = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { formId, id } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const response = await FormResponse.findOne({
    where: { id, formId },
  });

  if (!response) {
    throw new AppError("ERR_RESPONSE_NOT_FOUND", 404);
  }

  await response.update({ isStarred: !response.isStarred });

  return res.status(200).json(response);
};

export const exportData = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { formId } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
    include: [{ association: "fields", order: [["order", "ASC"]] }],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const responses = await FormResponse.findAll({
    where: {
      formId: form.id,
      submittedAt: { [Op.gte]: getResponsesCutoff() } as any,
    },
    include: [
      {
        association: "answers",
        include: [{ association: "field" }],
      },
    ],
    order: [["submittedAt", "DESC"]],
  });

  // Build Excel data
  const fields = form.fields || [];
  const formSettings = form.settings as any;
  const isQuotationForm = formSettings?.formType === "quotation";
  
  let headers: string[] = [];
  if (isQuotationForm) {
    headers = ["ID", "Nome", "Telefone", "Email", "Data", "Produto", "Quantidade", "Valor Unitário", "Valor Total", "Observações"];
  } else {
    headers = ["ID", "Nome", "Telefone", "Email", "Data", ...fields.map((f) => f.label)];
  }

  const rows: any[] = [];
  
  responses.forEach((response) => {
    if (isQuotationForm) {
      const quotationItems = (response.metadata as any)?.quotationItems || [];
      if (quotationItems.length > 0) {
        quotationItems.forEach((item: any, index: number) => {
          const row: any = {
            ID: index === 0 ? response.id : "", // Only show ID in first row
            Nome: index === 0 ? (response.responderName || "") : "",
            Telefone: index === 0 ? (response.responderPhone || "") : "",
            Email: index === 0 ? (response.responderEmail || "") : "",
            Data: index === 0 ? response.submittedAt : "",
            Produto: item.productName || "",
            Quantidade: item.quantity || 0,
            "Valor Unitário": item.unitValue ? parseFloat(item.unitValue).toFixed(2) : "0.00",
            "Valor Total": item.totalValue ? parseFloat(item.totalValue).toFixed(2) : "0.00",
            Observações: item.observations || "",
          };
          rows.push(row);
        });
      } else {
        // No quotation items, still create a row with basic info
        rows.push({
          ID: response.id,
          Nome: response.responderName || "",
          Telefone: response.responderPhone || "",
          Email: response.responderEmail || "",
          Data: response.submittedAt,
          Produto: "",
          Quantidade: "",
          "Valor Unitário": "",
          "Valor Total": "",
          Observações: "",
        });
      }
    } else {
      const row: any = {
        ID: response.id,
        Nome: response.responderName || "",
        Telefone: response.responderPhone || "",
        Email: response.responderEmail || "",
        Data: response.submittedAt,
      };

      fields.forEach((field) => {
        const answer = response.answers?.find((a) => a.fieldId === field.id);
        row[field.label] = answer?.answer || "";
      });

      rows.push(row);
    }
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Respostas");
  
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="formulario-${form.slug}-${Date.now()}.xlsx"`);

  return res.send(buffer);
};

export const getAnalytics = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { formId } = req.params;
  const { companyId } = req.user;

  // Verify form belongs to company
  const form = await Form.findOne({
    where: { id: formId, companyId },
    include: [{ association: "fields", order: [["order", "ASC"]] }],
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  const whereAnalytics = {
    formId: form.id,
    submittedAt: { [Op.gte]: getResponsesCutoff() } as any,
  };
  const responseCount = await FormResponse.count({
    where: whereAnalytics,
  });

  const responses = await FormResponse.findAll({
    where: whereAnalytics,
    include: [
      {
        association: "answers",
        include: [{ association: "field" }],
      },
    ],
  });

  // Group responses by date
  const responsesByDate: { [key: string]: number } = {};
  responses.forEach((response) => {
    const date = new Date(response.submittedAt).toISOString().split("T")[0];
    responsesByDate[date] = (responsesByDate[date] || 0) + 1;
  });

  // Field analytics
  const fieldAnalytics = form.fields?.map((field) => {
    const fieldAnswers = responses
      .flatMap((r) => r.answers || [])
      .filter((a) => a.fieldId === field.id)
      .map((a) => a.answer);

    let analysis: any = {
      fieldId: field.id,
      fieldLabel: field.label,
      fieldType: field.fieldType,
      totalAnswers: fieldAnswers.length,
    };

    if (field.fieldType === "select" || field.fieldType === "radio") {
      // Count occurrences of each option
      const counts: { [key: string]: number } = {};
      fieldAnswers.forEach((answer) => {
        counts[answer] = (counts[answer] || 0) + 1;
      });
      analysis.options = Object.keys(counts).map((option) => ({
        option,
        count: counts[option],
        percentage: fieldAnswers.length > 0 
          ? ((counts[option] / fieldAnswers.length) * 100).toFixed(2)
          : "0",
      }));
    }

    if (field.fieldType === "rating") {
      const ratings = fieldAnswers.map((a) => Number(a)).filter((n) => !isNaN(n));
      if (ratings.length > 0) {
        analysis.average = (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2);
        analysis.min = Math.min(...ratings);
        analysis.max = Math.max(...ratings);
      }
    }

    return analysis;
  }) || [];

  return res.json({
    formId: form.id,
    responseCount,
    responsesByDate,
    fieldAnalytics,
  });
};

export const reprintPrint = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const formId = Number(req.params.formId);
  const responseId = Number(req.params.id);

  const { job, dispatched } = await ReprintLastPrintJobForFormResponse({
    companyId,
    formId,
    formResponseId: responseId
  });

  return res.status(201).json({
    id: job.id,
    status: job.status,
    deviceId: job.deviceId,
    formResponseId: job.formResponseId,
    dispatched,
    message: dispatched
      ? "Reimpressão enviada para o agente de impressão."
      : "Reimpressão registrada e ficará na fila até o agente conectar à impressora."
  });
};

export const updateDeliveryOrder = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const formId = Number(req.params.formId);
  const responseId = Number(req.params.id);
  const { responderName, menuItems, address } = req.body || {};

  const { response, print } = await UpdateDeliveryOrderService({
    companyId,
    formId,
    responseId,
    responderName,
    menuItems,
    address,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-formResponse`, {
    action: "update",
    response,
  });

  return res.status(200).json({
    response,
    print,
    message:
      print.dispatched > 0
        ? "Pedido atualizado e enviado para reimpressão."
        : "Pedido atualizado. Reimpressão na fila aguardando o agente.",
  });
};
