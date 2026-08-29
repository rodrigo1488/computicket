import { randomUUID } from "crypto";
import Setting from "../../models/Setting";
import Product from "../../models/Product";
import ProductVariationOption from "../../models/ProductVariationOption";
import AddOnItem from "../../models/AddOnItem";
import PrintDevice from "../../models/PrintDevice";
import FormResponse from "../../models/FormResponse";
import Form from "../../models/Form";
import FormField from "../../models/FormField";
import { calcMenuItemLineTotal } from "../../helpers/gourmetOrderTotals";
import AppError from "../../errors/AppError";
import { isAgentConnected } from "../../libs/printWebSocket";
import { logger } from "../../utils/logger";
import { buildCustomerSnapshot } from "../../helpers/buildCustomerSnapshot";
import {
  extractFormPrintDevicePks,
  isUniplusFlagEnabled,
  resolveItemUniplusCodigo,
} from "./ValidateUniplusPreflightService";

const DEFAULT_PAYMENT_MAP: Record<string, string> = {
  pix: "valorpix",
  dinheiro: "valordinheiro",
  cartao: "valorcartao",
  outro: "valoroutros",
};

const PAYMENT_COLUMNS = [
  "valordinheiro",
  "valorcartao",
  "valorpix",
  "valorcarteiradigital",
  "valoroutros",
  "valorcheque",
] as const;

export interface UniplusPayloadItem {
  codigoproduto: string;
  nomeproduto: string;
  quantidade: number;
  precounitario: number;
  valortotal: number;
  unidademedida: string;
  observacao: string;
  orderidintegracao: string;
  /** UUID com hífens — UNIQUE contamesitem_uk1; vazio colide no Unichef */
  hash: string;
}

export interface UniplusDeliveryPayload {
  event: "uniplus.delivery";
  protocol: string;
  formResponseId: number;
  orderType: "delivery" | "mesa";
  tipopedido: number;
  numeromesa: number | null;
  contamesa: Record<string, unknown>;
  itens: UniplusPayloadItem[];
  /** Avisos de resolução (ex.: match só por nome) — agent ignora se não consumir */
  metadata?: {
    warnings?: string[];
  };
}

interface BuildRequest {
  companyId: number;
  form: Form;
  response: FormResponse;
  menuItems: any[];
  contactName?: string | null;
  contactPhone?: string | null;
  fields?: FormField[];
  answers?: Array<{ fieldId: number; answer: string | string[] }>;
}

const roundMoney = (n: number): number => Math.round(n * 100) / 100;

/**
 * UniPlus (Java UUID.fromString) exige UUID com hífens (8-4-4-4-12).
 * CHAR(40) no Postgres: preenche com espaços à direita.
 * Não remover hífens — hash sem hífen vira null no ORM e NPE em existeOperacaoPendenteUnichef.
 */
const padHash = (uuid: string): string => {
  const trimmed = String(uuid || "").trim();
  const hex = trimmed.replace(/-/g, "").replace(/\s/g, "");
  let withHyphens = trimmed;
  if (/^[0-9a-fA-F]{32}$/.test(hex)) {
    withHyphens = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return withHyphens.padEnd(40, " ").slice(0, 40);
};

function answerToString(answer: string | string[] | null | undefined): string {
  if (answer == null) return "";
  if (Array.isArray(answer)) return answer.map(String).filter(Boolean).join(", ").trim();
  return String(answer).trim();
}

async function getSettingMap(companyId: number): Promise<Record<string, string>> {
  const rows = await Setting.findAll({
    where: {
      companyId,
      key: [
        "uniplusEnabled",
        "uniplusIdFilial",
        "uniplusIdUsuario",
        "uniplusCnpjFilial",
        "uniplusPaymentMap",
        "uniplusPrintDeviceId",
      ],
    },
  });
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value ?? "";
  }
  return map;
}

function parsePaymentMap(raw: string | undefined): Record<string, string> {
  if (!raw) return { ...DEFAULT_PAYMENT_MAP };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { ...DEFAULT_PAYMENT_MAP, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PAYMENT_MAP };
}

function normalizePaymentMethod(raw: string): string {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (v.includes("pix")) return "pix";
  if (v.includes("dinheiro") || v.includes("especie")) return "dinheiro";
  if (v.includes("cartao") || v.includes("credito") || v.includes("debito")) return "cartao";
  if (v.includes("carteira")) return "carteira_digital";
  return "outro";
}

function findAnswerByLabel(
  fields: FormField[] | undefined,
  answers: Array<{ fieldId: number; answer: string | string[] }> | undefined,
  patterns: RegExp[]
): string {
  if (!fields?.length || !answers?.length) return "";
  for (const field of fields) {
    const label = String(field.label || "").toLowerCase();
    if (!patterns.some((p) => p.test(label))) continue;
    const ans = answers.find((a) => a.fieldId === field.id);
    const value = answerToString(ans?.answer);
    if (value) return value;
  }
  return "";
}

type ProductLite = { id: number; name?: string | null; idUniplus?: string | null };

export function formatHalfFlavorLabel(
  productId: number | null | undefined,
  productById: Map<number, ProductLite>
): string {
  const id = Number(productId);
  if (!Number.isFinite(id) || id <= 0) return "";
  const p = productById.get(id);
  if (!p) return "";
  const codigo = String(p.idUniplus || "").trim();
  const nome = String(p.name || "").trim();
  if (codigo && nome) return `${codigo} ${nome}`;
  return codigo || nome;
}

/**
 * Exposta para testes do contrato meio a meio → CONTAMESAITEM.observacao.
 *
 * `addonsOverride` permite listar só um subconjunto dos adicionais do item
 * (ex.: só os que NÃO ganharam linha própria de CONTAMESAITEM porque ainda
 * não têm idUniplus vinculado). Se omitido, usa `item.addons` inteiro —
 * comportamento de sempre.
 */
export function buildObservacao(
  item: any,
  productById: Map<number, ProductLite> = new Map(),
  addonsOverride?: Array<{ label?: string; name?: string }>
): string {
  const parts: string[] = [];
  if (item.type === "halfAndHalf") {
    const name = String(item.productName || "");
    const half1 = formatHalfFlavorLabel(item.half1ProductId, productById);
    const half2 = formatHalfFlavorLabel(item.half2ProductId, productById);
    if (half1 || half2) {
      parts.push(`Meio a meio: ${half1 || "?"} / ${half2 || "?"}`);
    } else if (name) {
      // Fallback quando não há half1/half2 resolvidos no catálogo
      parts.push(name.slice(0, 160));
    } else {
      parts.push("Meio a meio");
    }
  }
  const addonSource = addonsOverride ?? item.addons;
  if (Array.isArray(addonSource) && addonSource.length) {
    const addons = addonSource
      .map((a: any) => a.label || a.name)
      .filter(Boolean)
      .join(", ");
    if (addons) parts.push(`+ ${addons}`);
  }
  if (item.observacao || item.observation) {
    parts.push(String(item.observacao || item.observation));
  }
  return parts.join(" | ").slice(0, 255);
}

type AddOnLite = { id: number; idUniplus?: string | null; label?: string | null; value?: number | null };

export interface LinkedAddonGroup {
  addOnItemId: number;
  codigo: string;
  nome: string;
  qty: number;
  unit: number;
}

/**
 * Separa os adicionais já expandidos de um menuItem (`item.addons`, uma
 * entrada por unidade vendida) entre os que têm idUniplus vinculado (ganham
 * linha própria de CONTAMESAITEM, agrupados por addOnItemId) e os que não
 * têm (continuam só embutidos no item pai). Exposta pra testes unitários.
 */
export function groupLinkedAddons(
  addonEntries: Array<{ addOnItemId?: number; label?: string; value?: number }>,
  addOnById: Map<number, AddOnLite>
): { linkedGroups: LinkedAddonGroup[]; unlinkedAddons: typeof addonEntries } {
  const groups = new Map<number, LinkedAddonGroup>();
  const unlinkedAddons: typeof addonEntries = [];

  for (const addon of addonEntries || []) {
    const addOnItem = addOnById.get(Number(addon?.addOnItemId));
    const addonCodigo = String(addOnItem?.idUniplus || "").trim();
    if (!addOnItem || !addonCodigo) {
      unlinkedAddons.push(addon);
      continue;
    }
    const unit = Number(addon.value ?? addOnItem.value) || 0;
    const existing = groups.get(addOnItem.id);
    if (existing) {
      existing.qty += 1;
    } else {
      groups.set(addOnItem.id, {
        addOnItemId: addOnItem.id,
        codigo: addonCodigo,
        nome: String(addon.label || addOnItem.label || "Adicional"),
        qty: 1,
        unit,
      });
    }
  }

  return { linkedGroups: [...groups.values()], unlinkedAddons };
}

export async function isUniplusEnabledForCompany(companyId: number): Promise<boolean> {
  const settings = await getSettingMap(companyId);
  return isUniplusFlagEnabled(settings.uniplusEnabled);
}

export async function getUniplusPrintDeviceId(companyId: number): Promise<number | null> {
  const settings = await getSettingMap(companyId);
  const id = Number(settings.uniplusPrintDeviceId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Resolve deviceId (string do agente) sem preflight:
 * prioriza impressoras de delivery do cardápio, depois uniplusPrintDeviceId.
 * Prefere agent online; senão o primeiro encontrado.
 */
export async function resolveUniplusDeviceId(
  companyId: number,
  form: Form
): Promise<string | null> {
  const settings = await getSettingMap(companyId);
  const configuredPk = Number(settings.uniplusPrintDeviceId);
  const deliveryPks = extractFormPrintDevicePks(form);

  const candidates: number[] = [];
  for (const pk of deliveryPks) {
    if (Number.isFinite(pk) && pk > 0 && !candidates.includes(pk)) {
      candidates.push(pk);
    }
  }
  if (Number.isFinite(configuredPk) && configuredPk > 0 && !candidates.includes(configuredPk)) {
    candidates.push(configuredPk);
  }

  if (!candidates.length) return null;

  const foundDevices: PrintDevice[] = [];
  for (const pk of candidates) {
    const found = await PrintDevice.findOne({
      where: { id: pk, companyId },
    });
    if (found?.deviceId) foundDevices.push(found);
  }
  if (!foundDevices.length) return null;

  const printDevice =
    foundDevices.find((d) => isAgentConnected(companyId, d.deviceId)) ||
    foundDevices[0];

  if (deliveryPks.includes(printDevice.id) && Number(configuredPk) !== printDevice.id) {
    logger.info(
      `Uniplus: usando device de impressão do delivery companyId=${companyId} deviceId=${printDevice.deviceId} pk=${printDevice.id}`
    );
  }

  return printDevice.deviceId;
}

const BuildUniplusDeliveryPayloadService = async ({
  companyId,
  form,
  response,
  menuItems,
  contactName,
  contactPhone,
  fields,
  answers,
}: BuildRequest): Promise<UniplusDeliveryPayload> => {
  // Sem validação de flags company/form — despacho best-effort; agent resolve produtos
  const settings = await getSettingMap(companyId);
  void form;

  const protocol = String(response.protocol || `FR-${response.id}`).slice(0, 40);
  const meta = (response.metadata || {}) as Record<string, any>;
  const items = Array.isArray(menuItems) ? menuItems : [];

  // Inclui base + sabores do meio a meio + integrantes de combo
  const productIds = [
    ...new Set(
      items
        .flatMap((it) => [
          Number(it.productId),
          Number(it.half1ProductId),
          Number(it.half2ProductId),
          ...(Array.isArray(it.comboItems)
            ? it.comboItems.map((ci: any) => Number(ci.productId))
            : []),
        ])
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  const products = productIds.length
    ? await Product.findAll({
        where: { companyId, id: productIds },
        attributes: ["id", "name", "idUniplus", "value"],
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const catalog = await Product.findAll({
    where: { companyId },
    attributes: ["id", "name", "idUniplus"],
  });
  const catalogWithCode = catalog.filter((p) => String(p.idUniplus || "").trim());

  const optionIds = [
    ...new Set(
      items
        .flatMap((it) => [
          Number(it.variationOptionId),
          Number(it.baseOptionId),
          Number(it.half1OptionId),
          Number(it.half2OptionId),
          ...(Array.isArray(it.comboItems)
            ? it.comboItems.map((ci: any) => Number(ci.variationOptionId))
            : []),
        ])
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  const options = optionIds.length
    ? await ProductVariationOption.findAll({
        where: { id: optionIds },
        attributes: ["id", "idUniplus", "label"],
      })
    : [];
  const optionById = new Map(options.map((o) => [o.id, o]));

  const addOnItemIds = [
    ...new Set(
      items
        .flatMap((it) =>
          Array.isArray(it.addons)
            ? it.addons.map((a: any) => Number(a.addOnItemId))
            : []
        )
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  const addOnItems = addOnItemIds.length
    ? await AddOnItem.findAll({
        where: { id: addOnItemIds },
        attributes: ["id", "idUniplus", "label"],
      })
    : [];
  const addOnById = new Map(addOnItems.map((a) => [a.id, a]));

  const payloadItems: UniplusPayloadItem[] = [];
  const warnings: string[] = [];
  for (const item of items) {
    // Combo: não envia o produto-pai; explode cada integrante com o valor do combo
    if (item.type === "combo") {
      const comboName = String(item.productName || "Combo").slice(0, 80);
      const comboQty = Number(item.quantity) || 1;
      const comboObs = String(item.observation || item.observacao || "").trim();
      const constituents = Array.isArray(item.comboItems) ? item.comboItems : [];

      if (!constituents.length) {
        const msg = `combo productId=${item.productId} sem integrantes no snapshot`;
        warnings.push(msg);
        logger.warn({ protocol, productId: item.productId }, "Uniplus payload: combo sem comboItems");
        continue;
      }

      for (const ci of constituents) {
        const childProduct = productById.get(Number(ci.productId));
        const optionCodigo = ci.variationOptionId
          ? String(optionById.get(Number(ci.variationOptionId))?.idUniplus || "").trim()
          : "";
        const codigo =
          String(ci.idUniplus || optionCodigo || childProduct?.idUniplus || "").trim() ||
          resolveItemUniplusCodigo(
            {
              productId: ci.productId,
              productName: ci.productName,
              variationOptionId: ci.variationOptionId,
            },
            productById,
            catalogWithCode,
            optionById
          );
        const nomeproduto = String(
          ci.productName || childProduct?.name || "Produto"
        ).slice(0, 120);
        const unitQty = Math.max(1, Number(ci.quantity) || 1);
        const quantidade = unitQty * comboQty;
        const precounitario = roundMoney(Number(ci.value) || 0);
        const valortotal = roundMoney(precounitario * quantidade);
        const obsParts = [`Combo: ${comboName}`];
        if (comboObs) obsParts.push(comboObs);
        const observacao = obsParts.join(" | ").slice(0, 255);

        if (!codigo) {
          const msg = `integrante de combo productId=${ci.productId} sem idUniplus — agent resolverá por nome: ${nomeproduto}`;
          warnings.push(msg);
          logger.warn(
            { protocol, productId: ci.productId, comboProductId: item.productId, nomeproduto },
            "Uniplus payload: integrante de combo sem idUniplus"
          );
        }

        payloadItems.push({
          codigoproduto: (codigo || "").slice(0, 20),
          nomeproduto,
          quantidade,
          precounitario,
          valortotal,
          unidademedida: "UN",
          observacao,
          orderidintegracao: protocol,
          hash: padHash(randomUUID()),
        });
      }
      continue;
    }

    const product = productById.get(Number(item.productId));
    const codigo = resolveItemUniplusCodigo(
      item,
      productById,
      catalogWithCode,
      optionById
    );
    const nomeproduto = String(
      item.productName || product?.name || "Produto"
    ).slice(0, 120);
    const qty = Number(item.quantity) || 1;
    const lineTotal = calcMenuItemLineTotal(item);

    const optionCodigo = [
      Number(item.variationOptionId),
      Number(item.baseOptionId),
      Number(item.half1OptionId),
      Number(item.half2OptionId),
    ]
      .filter((id) => Number.isFinite(id) && id > 0)
      .some((id) => String(optionById.get(id)?.idUniplus || "").trim());
    const baseHasCodigo = Boolean(String(product?.idUniplus || "").trim());
    if (!codigo) {
      const msg = `item productId=${item.productId} sem idUniplus — agent resolverá por nome (risco de ambiguidade): ${nomeproduto}`;
      warnings.push(msg);
      logger.warn(
        {
          protocol,
          productId: item.productId,
          type: item.type,
          nomeproduto,
        },
        "Uniplus payload: item sem idUniplus — agent resolverá por nome (risco de ambiguidade)"
      );
    } else if (
      item.type === "halfAndHalf" &&
      !baseHasCodigo &&
      !optionCodigo
    ) {
      const msg = `meio a meio productId=${item.productId} com codigo=${codigo} resolvido por nome longo (base sem idUniplus): ${nomeproduto}`;
      warnings.push(msg);
      logger.warn(
        {
          protocol,
          productId: item.productId,
          codigo,
          nomeproduto,
        },
        "Uniplus payload: meio a meio com codigo resolvido por nome (base sem idUniplus)"
      );
    }

    // Adicionais com idUniplus vinculado ganham linha própria de CONTAMESAITEM
    // (pra o UniPlus movimentar o estoque deles); os demais continuam só
    // embutidos no preço/observação do item pai, como sempre.
    const { linkedGroups, unlinkedAddons } = groupLinkedAddons(
      Array.isArray(item.addons) ? item.addons : [],
      addOnById
    );

    let parentValortotal = lineTotal;
    let parentObservacao = buildObservacao(item, productById);
    if (linkedGroups.length) {
      const linkedRawValue = linkedGroups.reduce(
        (sum, g) => sum + g.unit * g.qty,
        0
      );
      parentValortotal = Math.max(0, roundMoney(lineTotal - linkedRawValue));
      parentObservacao = buildObservacao(item, productById, unlinkedAddons);
    }
    const parentUnit = roundMoney(parentValortotal / qty);

    payloadItems.push({
      // codigo pode vir vazio — agent resolve por nome no UniPlus
      codigoproduto: (codigo || "").slice(0, 20),
      nomeproduto,
      quantidade: qty,
      precounitario: parentUnit,
      valortotal: parentValortotal,
      unidademedida: "UN",
      observacao: parentObservacao,
      orderidintegracao: protocol,
      hash: padHash(randomUUID()),
    });

    for (const group of linkedGroups) {
      payloadItems.push({
        codigoproduto: group.codigo.slice(0, 20),
        nomeproduto: group.nome.slice(0, 120),
        quantidade: group.qty,
        precounitario: roundMoney(group.unit),
        valortotal: roundMoney(group.unit * group.qty),
        unidademedida: "UN",
        observacao: `Adicional de ${nomeproduto}`.slice(0, 255),
        orderidintegracao: protocol,
        hash: padHash(randomUUID()),
      });
    }
  }

  if (!payloadItems.length) {
    throw new AppError("ERR_UNIPLUS_NO_ITEMS", 400);
  }

  const deliveryFee = roundMoney(Number(meta.deliveryFee) || 0);
  const subtotal = roundMoney(
    payloadItems.reduce((sum, it) => sum + Number(it.valortotal), 0)
  );
  const total = roundMoney(
    Number(meta.total) || subtotal + deliveryFee
  );

  const paymentLabel = findAnswerByLabel(fields, answers, [
    /pagamento/,
    /forma\s*de\s*pag/,
    /meio\s*de\s*pag/,
    /m[eé]todo\s*de\s*pag/,
  ]);
  const paymentMethod = normalizePaymentMethod(paymentLabel || "outro");
  const paymentMap = parsePaymentMap(settings.uniplusPaymentMap);
  let column = paymentMap[paymentMethod] || paymentMap.outro || "valoroutros";
  if (paymentMethod === "carteira_digital") {
    column = "valorcarteiradigital";
  }
  if (!(PAYMENT_COLUMNS as readonly string[]).includes(column)) {
    column = "valoroutros";
  }

  const valorPagamentos: Record<string, number> = {
    valordinheiro: 0,
    valorcartao: 0,
    valorpix: 0,
    valorcarteiradigital: 0,
    valoroutros: 0,
    valorcheque: 0,
  };
  valorPagamentos[column] = total;

  const snapshot = buildCustomerSnapshot(
    fields,
    answers,
    meta,
    contactName,
    contactPhone
  );
  const endereco = snapshot.endereco;
  const endereconumero = snapshot.endereconumero;
  const enderecobairro = snapshot.enderecobairro;
  const enderecocomplemento = snapshot.enderecocomplemento;
  const enderecoreferencia = snapshot.enderecoreferencia;
  const documento = snapshot.documento;

  const now = new Date();
  const idFilial = Number(settings.uniplusIdFilial) || 1;
  const idUsuario = Number(settings.uniplusIdUsuario) || 1;
  const cnpjFilial = String(settings.uniplusCnpjFilial || "").trim().slice(0, 18);
  const hash = padHash(randomUUID());

  const orderType = meta.orderType === "mesa" ? "mesa" : "delivery";
  const tableNumber = String(meta.tableNumber || "").trim();
  const garcomName = String(meta.garcomName || "").trim();
  const clienteNome = snapshot.customerName;
  const nomeDisplay = clienteNome.slice(0, 60);
  const mesaNum = tableNumber ? parseInt(tableNumber.replace(/\D/g, ""), 10) : NaN;
  const numeromesaExplicit =
    orderType === "mesa" && Number.isFinite(mesaNum) && mesaNum > 0 ? mesaNum : null;
  const tipopedido = orderType === "mesa" ? 1 : 0;

  const obsParts = [
    garcomName ? `Garçom: ${garcomName}` : "",
    snapshot.orderNotes ? `Obs: ${snapshot.orderNotes}` : "",
    `Compuchat ${protocol}`,
  ].filter(Boolean);

  const contamesa: Record<string, unknown> = {
    orderType,
    tipopedido,
    status: 1,
    situacao: 0,
    numeromesa: numeromesaExplicit,
    statusagendamento: 3,
    pautaunica: 1,
    // Alinhado à inserção nativa do UniPlus
    abertaoffline: 1,
    idfilial: idFilial,
    idusuario: idUsuario,
    cnpjfilial: cnpjFilial,
    idcliente: 0,
    codigocliente: "",
    // Unico usa `nome` na listagem de delivery; `nomecliente` fica como espelho.
    nome: nomeDisplay,
    nomecliente: clienteNome.slice(0, 60),
    telefone: String(snapshot.phone || contactPhone || response.responderPhone || "").slice(0, 20),
    documento: String(documento).slice(0, 18),
    endereco: String(endereco).slice(0, 60),
    endereconumero: String(endereconumero).slice(0, 12),
    enderecobairro: String(enderecobairro).slice(0, 255),
    enderecocomplemento: String(enderecocomplemento).slice(0, 255),
    enderecoreferencia: String(enderecoreferencia).slice(0, 255),
    valorentrega: orderType === "mesa" ? 0 : deliveryFee,
    valortotal: total,
    valorcombinado: total,
    ...valorPagamentos,
    tipointegracao: 0,
    nomeintegracao: "",
    orderidintegracao: protocol,
    hash,
    statussinc: 1,
    cupomcancelado: 0,
    retiradanobalcao: meta.pickup === true || meta.retirada === true ? 1 : 0,
    retirabalcaodepois: 0,
    paraviagem: 0,
    numeropessoas: 1,
    desconto: 0,
    obs: obsParts.join(" | ").slice(0, 255),
    data: now.toISOString().slice(0, 10),
    horaabertura: now.toISOString(),
    horaultimoconsumo: now.toISOString(),
    horapedidoefetuado: now.toISOString(),
    currenttimemillis: Date.now(),
    timestampalteracao: Date.now(),
  };

  return {
    event: "uniplus.delivery",
    protocol,
    formResponseId: response.id,
    orderType,
    tipopedido,
    numeromesa: numeromesaExplicit,
    contamesa,
    itens: payloadItems,
    ...(warnings.length ? { metadata: { warnings } } : {}),
  };
};

export default BuildUniplusDeliveryPayloadService;
