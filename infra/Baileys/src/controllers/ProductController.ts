import * as Yup from "yup";
import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import CreateProductService from "../services/ProductServices/CreateProductService";
import UpdateProductService from "../services/ProductServices/UpdateProductService";
import DeleteProductService from "../services/ProductServices/DeleteProductService";
import DuplicateProductService from "../services/ProductServices/DuplicateProductService";
import ListProductsService from "../services/ProductServices/ListProductsService";
import ShowProductService from "../services/ProductServices/ShowProductService";
import ImportMenuFromDocumentService from "../services/ProductServices/ImportMenuFromDocumentService";
import CreateAddOnGroupService from "../services/AddOnGroupServices/CreateAddOnGroupService";
import uploadMenuFileConfig from "../config/uploadMenuFile";
import Product from "../models/Product";
import GrupoAddOn from "../models/GrupoAddOn";
import Form from "../models/Form";
import AddOnGroup from "../models/AddOnGroup";
import AddOnSubgroup from "../models/AddOnSubgroup";
import AddOnItem from "../models/AddOnItem";
import AppError from "../errors/AppError";
import { setPublicApiNoCacheHeaders } from "../helpers/setPublicApiNoCacheHeaders";
import { findPublicFormBySlug } from "../services/FormServices/FindPublicFormService";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { searchParam, pageNumber, isMenuProduct, grupo } = req.query;

  const result = await ListProductsService({
    companyId,
    searchParam: searchParam as string,
    pageNumber: pageNumber ? Number(pageNumber) : 1,
    isMenuProduct: isMenuProduct !== undefined ? isMenuProduct === "true" : undefined,
    grupo: grupo as string,
  });

  return res.json(result);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const productId = Number(id);
  if (isNaN(productId)) {
    throw new AppError("ERR_PRODUCT_NOT_FOUND", 404);
  }

  const product = await ShowProductService({
    productId,
    companyId,
  });

  return res.json(product);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const data = { ...req.body };
  if (!data.allowsHalfAndHalf || data.halfAndHalfPriceRule === "" || data.halfAndHalfPriceRule === "null" || data.halfAndHalfPriceRule == null) {
    data.halfAndHalfPriceRule = null;
  }

  const schema = Yup.object().shape({
    name: Yup.string().required("Nome do produto é obrigatório"),
    description: Yup.string().nullable(),
    value: Yup.number()
      .min(0, "Valor deve ser maior ou igual a zero")
      .nullable(),
    quantity: Yup.number()
      .integer("Quantidade deve ser um número inteiro")
      .min(0, "Quantidade deve ser maior ou igual a zero")
      .nullable(),
    isMenuProduct: Yup.boolean().nullable(),
    variablePrice: Yup.boolean().nullable(),
    isCombo: Yup.boolean().nullable(),
    allowsHalfAndHalf: Yup.boolean().nullable(),
    halfAndHalfPriceRule: Yup.string()
      .transform((v) => (v === "" || v == null || v === "null" ? null : v))
      .nullable()
      .test(
        "oneOfOrNull",
        "halfAndHalfPriceRule must be one of the following values: max, fixed, average",
        (v) => v == null || v === "" || v === "null" || ["max", "fixed", "average"].includes(String(v))
      ),
    halfAndHalfGrupo: Yup.string().nullable(),
    grupo: Yup.string().nullable(),
    imageUrl: Yup.string().nullable(),
    idUniplus: Yup.string().max(20).nullable(),
    addOnGroupId: Yup.number().nullable(),
    variations: Yup.array()
      .of(
        Yup.object().shape({
          name: Yup.string().required(),
          options: Yup.array()
            .of(
              Yup.object().shape({
                label: Yup.string().required(),
                value: Yup.number().min(0).required(),
                idUniplus: Yup.string().max(20).nullable(),
              })
            )
            .min(1)
            .required(),
        })
      )
      .nullable(),
    comboItems: Yup.array()
      .of(
        Yup.object().shape({
          productId: Yup.number().required(),
          value: Yup.number().min(0).required(),
          quantity: Yup.number().integer().min(1).nullable(),
          order: Yup.number().integer().min(0).nullable(),
          variationOptionId: Yup.number().nullable(),
        })
      )
      .nullable(),
  }).test(
    "halfAndHalfRule",
    "Regra de cobrança é obrigatória quando 'Permitir meio a meio' está ativo",
    (obj: any) => {
      if (obj?.isCombo === true) return true;
      if (obj?.allowsHalfAndHalf === true) {
        return obj?.halfAndHalfPriceRule != null && ["max", "fixed", "average"].includes(obj.halfAndHalfPriceRule);
      }
      return true;
    }
  ).test(
    "comboOrValue",
    "Valor é obrigatório",
    (obj: any) => {
      if (obj?.isCombo === true) {
        return Array.isArray(obj?.comboItems) && obj.comboItems.length > 0;
      }
      return obj?.value != null && Number(obj.value) >= 0;
    }
  );

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const product = await CreateProductService({
    ...data,
    value: data.isCombo ? 0 : data.value,
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-product`, {
    action: "create",
    product,
  });

  return res.status(200).json(product);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;
  const data = { ...req.body };
  if (!data.allowsHalfAndHalf || data.halfAndHalfPriceRule === "" || data.halfAndHalfPriceRule === "null" || data.halfAndHalfPriceRule == null) {
    data.halfAndHalfPriceRule = null;
  }

  const schema = Yup.object().shape({
    name: Yup.string().nullable(),
    description: Yup.string().nullable(),
    value: Yup.number()
      .min(0, "Valor deve ser maior ou igual a zero")
      .nullable(),
    quantity: Yup.number()
      .integer("Quantidade deve ser um número inteiro")
      .min(0, "Quantidade deve ser maior ou igual a zero")
      .nullable(),
    isMenuProduct: Yup.boolean().nullable(),
    isCombo: Yup.boolean().nullable(),
    allowsHalfAndHalf: Yup.boolean().nullable(),
    halfAndHalfPriceRule: Yup.string()
      .transform((v) => (v === "" || v == null || v === "null" ? null : v))
      .nullable()
      .test(
        "oneOfOrNull",
        "halfAndHalfPriceRule must be one of the following values: max, fixed, average",
        (v) => v == null || v === "" || v === "null" || ["max", "fixed", "average"].includes(String(v))
      ),
    halfAndHalfGrupo: Yup.string().nullable(),
    grupo: Yup.string().nullable(),
    imageUrl: Yup.string().nullable(),
    idUniplus: Yup.string().max(20).nullable(),
    addOnGroupId: Yup.number().nullable(),
    variations: Yup.array()
      .of(
        Yup.object().shape({
          name: Yup.string().required(),
          options: Yup.array()
            .of(
              Yup.object().shape({
                label: Yup.string().required(),
                value: Yup.number().min(0).required(),
                idUniplus: Yup.string().max(20).nullable(),
              })
            )
            .min(1)
            .required(),
        })
      )
      .nullable(),
    comboItems: Yup.array()
      .of(
        Yup.object().shape({
          productId: Yup.number().required(),
          value: Yup.number().min(0).required(),
          quantity: Yup.number().integer().min(1).nullable(),
          order: Yup.number().integer().min(0).nullable(),
          variationOptionId: Yup.number().nullable(),
        })
      )
      .nullable(),
  }).test(
    "halfAndHalfRule",
    "Regra de cobrança é obrigatória quando 'Permitir meio a meio' está ativo",
    (obj: any) => {
      if (obj?.isCombo === true) return true;
      if (obj?.allowsHalfAndHalf === true) {
        return obj?.halfAndHalfPriceRule != null && ["max", "fixed", "average"].includes(obj.halfAndHalfPriceRule);
      }
      return true;
    }
  ).test(
    "comboItemsWhenCombo",
    "Combo precisa de pelo menos um produto integrante",
    (obj: any) => {
      if (obj?.isCombo === true && obj?.comboItems !== undefined) {
        return Array.isArray(obj.comboItems) && obj.comboItems.length > 0;
      }
      return true;
    }
  );

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const product = await UpdateProductService({
    productId: Number(id),
    companyId,
    ...data,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-product`, {
    action: "update",
    product,
  });

  return res.status(200).json(product);
};

export const destroy = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  await DeleteProductService({
    productId: Number(id),
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-product`, {
    action: "delete",
    productId: Number(id),
  });

  return res.status(200).json({ message: "Produto deletado com sucesso" });
};

export const getPublicMenuProducts = async (
  req: Request,
  res: Response
): Promise<Response> => {
  setPublicApiNoCacheHeaders(res);
  const { publicId } = req.params as any;

  const form = await findPublicFormBySlug(publicId, {
    attributes: ["id", "companyId"],
  });

  // Buscar todos os produtos de cardápio da empresa (com variações, combos e addOnGroupId).
  // Fallback sem isCombo/comboItems se a migration ainda não rodou em produção.
  const baseAttributes = [
    "id",
    "name",
    "description",
    "value",
    "grupo",
    "isMenuProduct",
    "variablePrice",
    "imageUrl",
    "allowsHalfAndHalf",
    "halfAndHalfPriceRule",
    "halfAndHalfGrupo",
    "addOnGroupId",
  ];
  const comboInclude = {
    association: "comboItems" as const,
    include: [
      {
        association: "product" as const,
        attributes: ["id", "name", "value", "grupo"],
      },
      {
        association: "variationOption" as const,
        attributes: ["id", "label", "value"],
      },
    ],
  };

  let products: Product[];
  try {
    products = await Product.findAll({
      where: {
        companyId: form.companyId,
        isMenuProduct: true,
      },
      order: [["grupo", "ASC"], ["name", "ASC"]],
      attributes: [...baseAttributes, "isCombo"],
      include: [
        { association: "variations", include: [{ association: "options" }] },
        comboInclude,
      ],
    });
  } catch (err) {
    console.error(
      "[getPublicMenuProducts] Falha ao carregar com combos; tentando sem isCombo/comboItems:",
      (err as Error)?.message || err
    );
    products = await Product.findAll({
      where: {
        companyId: form.companyId,
        isMenuProduct: true,
      },
      order: [["grupo", "ASC"], ["name", "ASC"]],
      attributes: baseAttributes,
      include: [
        { association: "variations", include: [{ association: "options" }] },
      ],
    });
  }

  // Mapeamento grupo -> addOnGroupId (atribuição por categoria)
  const grupoAssignments = await GrupoAddOn.findAll({
    where: { companyId: form.companyId },
    attributes: ["grupo", "addOnGroupId"],
  });
  const grupoToAddOnId = new Map(grupoAssignments.map((a) => [a.grupo, a.addOnGroupId]));

  const addOnGroupIds = new Set<number>();
  products.forEach((p) => {
    const resolved = p.addOnGroupId ?? (p.grupo ? grupoToAddOnId.get(p.grupo) : undefined);
    if (resolved) addOnGroupIds.add(resolved);
  });

  const addOnGroupsRaw = await AddOnGroup.findAll({
    where: { id: Array.from(addOnGroupIds), companyId: form.companyId },
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
        required: sg.required === true,
        minItems: Number(sg.minItems) || 0,
        maxItems: sg.maxItems != null ? Number(sg.maxItems) : null,
        items: (sg.items || []).slice().sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)).map((it: any) => ({ id: it.id, label: it.label, value: Number(it.value), order: it.order })),
      }));
      const rootItems = (g.items || []).filter((it: any) => !it.addOnSubgroupId).sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)).map((it: any) => ({ id: it.id, label: it.label, value: Number(it.value), order: it.order }));
      return [
        g.id,
        {
          id: g.id,
          name: g.name,
          required: (g as any).required === true,
          minItems: Number((g as any).minItems) || 0,
          maxItems: (g as any).maxItems != null ? Number((g as any).maxItems) : null,
          subgroups,
          items: rootItems,
        },
      ];
    })
  );

  const productsWithAddOn = products.map((p) => {
    const po = p.toJSON() as Record<string, unknown> & {
      addOnGroupId?: number | null;
      grupo?: string;
      isCombo?: boolean;
    };
    // Combo não usa adicionais no pedido
    if (po.isCombo) {
      po.addOnGroup = null;
      po.addOnGroupId = null;
      return po;
    }
    const resolvedAddOnId = po.addOnGroupId ?? (po.grupo ? grupoToAddOnId.get(po.grupo) : undefined);
    po.addOnGroup = resolvedAddOnId ? addOnGroupMap.get(resolvedAddOnId) ?? null : null;
    return po;
  });

  return res.json({
    products: productsWithAddOn,
    count: productsWithAddOn.length,
  });
};

export const uploadImage = async (req: Request, res: Response): Promise<Response> => {
  const file = req.file as Express.Multer.File;
  if (!file || !file.filename) {
    throw new AppError("ERR_PRODUCT_IMAGE_REQUIRED", 400);
  }
  const baseUrl = process.env.BACKEND_URL || "http://localhost:3333";
  const imageUrl = `${baseUrl.replace(/\/$/, "")}/public/products/${file.filename}`;
  return res.json({ imageUrl });
};

export const duplicate = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  const product = await DuplicateProductService({
    productId: Number(id),
    companyId,
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-product`, {
    action: "create",
    product,
  });

  return res.status(200).json(product);
};

function sendSSE(res: Response, data: object): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export const importFromMenu = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const file = req.file as Express.Multer.File;
  if (!file || !file.filename) {
    throw new AppError("Envie um arquivo (PDF ou imagem) do cardápio.", 400);
  }
  const filePath = (file as any).path || path.join(uploadMenuFileConfig.directory, file.filename);
  const isPdf = file.mimetype === "application/pdf";

  if (isPdf) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    try {
      const preview = await ImportMenuFromDocumentService({
        companyId,
        filePath,
        mimeType: file.mimetype,
        onPageExtracted: (page, total) => {
          sendSSE(res, { event: "page", page, total });
          if (typeof (res as any).flush === "function") (res as any).flush();
        },
      });
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
      sendSSE(res, { event: "done", preview });
    } catch (err: any) {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
      sendSSE(res, { event: "error", message: err?.message || "Erro ao processar o cardápio." });
    }
    res.end();
    return res;
  }

  try {
    const preview = await ImportMenuFromDocumentService({
      companyId,
      filePath,
      mimeType: file.mimetype,
    });
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return res.json({ preview });
  } catch (err) {
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
    throw err;
  }
};

export const confirmImportFromMenu = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const {
    produtos,
    adicionais,
  } = req.body as {
    produtos: Array<{ nome: string; descricao?: string; grupo?: string; valor: number }>;
    adicionais?: Array<{
      nomeGrupo: string;
      itens: Array<{ label: string; valor: number }>;
      gruposProduto: string[];
    }>;
  };
  if (!Array.isArray(produtos) || produtos.length === 0) {
    throw new AppError("Envie uma lista de produtos para importar.", 400);
  }
  const created: Product[] = [];
  const io = getIO();
  for (const item of produtos) {
    const value = typeof item.valor === "number" ? item.valor : parseFloat(String(item.valor).replace(",", "."));
    if (isNaN(value) || value < 0) continue;
    const name = String(item.nome || "").trim();
    const grupo = (item.grupo && String(item.grupo).trim()) || "Outros";
    if (!name) continue;
    try {
      const product = await CreateProductService({
        name,
        description: item.descricao ?? undefined,
        value,
        quantity: 0,
        isMenuProduct: true,
        grupo,
        companyId,
      });
      created.push(product);
      io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-product`, {
        action: "create",
        product,
      });
    } catch {
      // skip invalid items
    }
  }

  if (Array.isArray(adicionais) && adicionais.length > 0) {
    const grupoToItems = new Map<string, Array<{ label: string; value: number }>>();
    for (const ad of adicionais) {
      const nomeGrupo = (ad.nomeGrupo && String(ad.nomeGrupo).trim()) || "Adicionais";
      const itens = (ad.itens || [])
        .filter((it) => it && String(it.label || "").trim())
        .map((it) => ({
          label: String(it.label).trim(),
          value: typeof it.valor === "number" ? it.valor : parseFloat(String(it.valor).replace(",", ".")) || 0,
        }))
        .filter((it) => it.value >= 0);
      if (itens.length === 0) continue;
      const gruposProduto = (ad.gruposProduto || []).filter((g) => typeof g === "string").map((g) => String(g).trim()).filter(Boolean);
      if (gruposProduto.length === 0) continue;
      for (const g of gruposProduto) {
        const key = g || "Outros";
        if (!grupoToItems.has(key)) grupoToItems.set(key, []);
        const existing = grupoToItems.get(key)!;
        const existingLabels = new Set(existing.map((i) => i.label));
        for (const it of itens) {
          if (!existingLabels.has(it.label)) {
            existing.push(it);
            existingLabels.add(it.label);
          }
        }
      }
    }
    for (const [grupo, items] of grupoToItems.entries()) {
      if (items.length === 0) continue;
      try {
        const addOnGroup = await CreateAddOnGroupService({
          companyId,
          name: `Adicionais - ${grupo}`,
          items: items.map((it, i) => ({ label: it.label, value: it.value, order: i })),
        });
        const [row, created] = await GrupoAddOn.findOrCreate({
          where: { companyId, grupo },
          defaults: { companyId, grupo, addOnGroupId: addOnGroup.id },
        });
        if (!created) await row.update({ addOnGroupId: addOnGroup.id });
      } catch {
        // skip on error
      }
    }
  }

  return res.status(200).json({ created, count: created.length });
};
