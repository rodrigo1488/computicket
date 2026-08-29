import Setting from "../../models/Setting";
import Product from "../../models/Product";
import ProductVariationOption from "../../models/ProductVariationOption";
import PrintDevice from "../../models/PrintDevice";
import Form from "../../models/Form";
import { isAgentConnected } from "../../libs/printWebSocket";
import { logger } from "../../utils/logger";

export type UniplusPreflightCode =
  | "OK"
  | "ERR_UNIPLUS_COMPANY_DISABLED"
  | "ERR_UNIPLUS_FORM_DISABLED"
  | "ERR_UNIPLUS_NOT_DELIVERY"
  | "ERR_UNIPLUS_NO_ITEMS"
  | "ERR_UNIPLUS_DEVICE_NOT_SET"
  | "ERR_UNIPLUS_DEVICE_NOT_FOUND"
  | "ERR_UNIPLUS_ID_FILIAL_INVALID"
  | "ERR_UNIPLUS_ID_USUARIO_INVALID"
  | "ERR_UNIPLUS_PRODUCT_CODE_MISSING";

export interface UniplusPreflightResult {
  ok: boolean;
  code: UniplusPreflightCode;
  message: string;
  deviceId?: string;
  missingProductIds?: number[];
  missingProductNames?: string[];
}

interface PreflightRequest {
  companyId: number;
  form: Form;
  menuItems: any[];
  orderType?: string | null;
  /** PKs de PrintDevice do cardápio (delivery/print) — prioridade sobre uniplusPrintDeviceId */
  fallbackDevicePks?: number[];
}

async function getSettingMap(companyId: number): Promise<Record<string, string>> {
  const rows = await Setting.findAll({
    where: {
      companyId,
      key: [
        "uniplusEnabled",
        "uniplusIdFilial",
        "uniplusIdUsuario",
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

/** Aceita enabled/true/1/sim (string ou boolean). */
export function isUniplusFlagEnabled(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  return s === "enabled" || s === "true" || s === "1" || s === "sim" || s === "yes";
}

export function isFormUniplusEnabled(form: Form): boolean {
  return isUniplusFlagEnabled((form.settings as any)?.uniplus?.enabled);
}

/**
 * Extrai PrintDevice PKs configurados no cardápio para impressão delivery/mesa.
 */
export function extractFormPrintDevicePks(form: Form): number[] {
  const settings = (form.settings || {}) as Record<string, any>;
  const ids = new Set<number>();

  const deliveryIds = settings.deliveryPrintDeviceIds;
  if (Array.isArray(deliveryIds)) {
    for (const id of deliveryIds) {
      const n = Number(id);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  }

  const printDeviceId = Number(settings.printDeviceId);
  if (Number.isFinite(printDeviceId) && printDeviceId > 0) {
    ids.add(printDeviceId);
  }

  const mesaPrintConfig = settings.mesaPrintConfig;
  if (Array.isArray(mesaPrintConfig)) {
    for (const row of mesaPrintConfig) {
      const n = Number(row?.printDeviceId);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  }

  return [...ids];
}

function itemCodigoHint(item: any): string {
  return String(
    item?.idUniplus ||
      item?.codigoproduto ||
      item?.codigoProduto ||
      item?.codigo ||
      item?.productCode ||
      ""
  ).trim();
}

type OptionLite = { id: number; idUniplus?: string | null };

/**
 * Resolve código UniPlus do item (= produto.codigo visível no UniPlus, NÃO o id interno).
 * Ordem: campo do item → option (variationOptionId / baseOptionId / half*OptionId)
 * → Product.idUniplus → match por nome no catálogo com código.
 */
export function resolveItemUniplusCodigo(
  item: any,
  byId: Map<number, Product>,
  catalog: Product[],
  optionById: Map<number, OptionLite> = new Map()
): string {
  const direct = itemCodigoHint(item);
  if (direct) return direct;

  // Meio a meio: prioriza tamanho do base; item normal: variationOptionId / optionId
  const optionIds = (
    item?.type === "halfAndHalf"
      ? [
          Number(item?.baseOptionId),
          Number(item?.variationOptionId),
          Number(item?.optionId),
          Number(item?.half1OptionId),
          Number(item?.half2OptionId),
        ]
      : [
          Number(item?.variationOptionId),
          Number(item?.optionId),
          Number(item?.baseOptionId),
          Number(item?.half1OptionId),
          Number(item?.half2OptionId),
        ]
  ).filter((id) => Number.isFinite(id) && id > 0);

  for (const oid of optionIds) {
    const code = String(optionById.get(oid)?.idUniplus || "").trim();
    if (code) return code;
  }

  const pid = Number(item?.productId);
  const byProduct = byId.get(pid);
  return String(byProduct?.idUniplus || "").trim();
}

/**
 * Valida pré-requisitos UniPlus sem lançar erro ao cliente.
 * Pedido Compuchat nunca deve ser bloqueado por este serviço.
 */
const ValidateUniplusPreflightService = async ({
  companyId,
  form,
  menuItems,
  orderType,
  fallbackDevicePks,
}: PreflightRequest): Promise<UniplusPreflightResult> => {
  if (!isFormUniplusEnabled(form)) {
    return {
      ok: false,
      code: "ERR_UNIPLUS_FORM_DISABLED",
      message: "UniPlus desabilitado neste cardápio",
    };
  }

  if (String(orderType || "").toLowerCase() !== "delivery") {
    return {
      ok: false,
      code: "ERR_UNIPLUS_NOT_DELIVERY",
      message: "UniPlus só sincroniza pedidos delivery",
    };
  }

  const items = Array.isArray(menuItems) ? menuItems : [];
  if (!items.length) {
    return {
      ok: false,
      code: "ERR_UNIPLUS_NO_ITEMS",
      message: "Pedido sem itens para UniPlus",
    };
  }

  const settings = await getSettingMap(companyId);
  if (!isUniplusFlagEnabled(settings.uniplusEnabled)) {
    return {
      ok: false,
      code: "ERR_UNIPLUS_COMPANY_DISABLED",
      message: "UniPlus desabilitado nas configurações da empresa",
    };
  }

  // Filial/usuário: não bloquear despacho — o builder usa fallback || 1
  const idFilial = Number(settings.uniplusIdFilial);
  if (!Number.isFinite(idFilial) || idFilial <= 0) {
    logger.warn(
      `Uniplus preflight: uniplusIdFilial ausente/inválido companyId=${companyId} — seguirá com fallback 1`
    );
  }
  const idUsuario = Number(settings.uniplusIdUsuario);
  if (!Number.isFinite(idUsuario) || idUsuario <= 0) {
    logger.warn(
      `Uniplus preflight: uniplusIdUsuario ausente/inválido companyId=${companyId} — seguirá com fallback 1`
    );
  }

  // Prioridade: devices que JÁ imprimem o delivery (online comprovado), depois setting UniPlus
  const configuredPk = Number(settings.uniplusPrintDeviceId);
  const deliveryPks =
    Array.isArray(fallbackDevicePks) && fallbackDevicePks.length
      ? fallbackDevicePks
      : extractFormPrintDevicePks(form);

  const candidates: number[] = [];
  for (const pk of deliveryPks) {
    if (Number.isFinite(pk) && pk > 0 && !candidates.includes(pk)) {
      candidates.push(pk);
    }
  }
  if (Number.isFinite(configuredPk) && configuredPk > 0 && !candidates.includes(configuredPk)) {
    candidates.push(configuredPk);
  }

  if (!candidates.length) {
    return {
      ok: false,
      code: "ERR_UNIPLUS_DEVICE_NOT_SET",
      message:
        "Nenhuma impressora de delivery no cardápio e uniplusPrintDeviceId não configurado",
    };
  }

  const foundDevices: PrintDevice[] = [];
  for (const pk of candidates) {
    const found = await PrintDevice.findOne({
      where: { id: pk, companyId },
    });
    if (found?.deviceId) {
      foundDevices.push(found);
    }
  }

  if (!foundDevices.length) {
    return {
      ok: false,
      code: "ERR_UNIPLUS_DEVICE_NOT_FOUND",
      message: `Nenhum PrintDevice UniPlus válido entre candidatos=[${candidates.join(",")}]`,
    };
  }

  let printDevice =
    foundDevices.find((d) => isAgentConnected(companyId, d.deviceId)) || foundDevices[0];
  const usedDeliveryDevice = deliveryPks.includes(printDevice.id);
  if (usedDeliveryDevice && Number(configuredPk) !== printDevice.id) {
    logger.warn(
      `Uniplus preflight: usando device de impressão do delivery companyId=${companyId} deviceId=${printDevice.deviceId} pk=${printDevice.id}`
    );
  }

  const productIds = [
    ...new Set(
      items
        .map((it) => Number(it.productId))
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];

  const products = productIds.length
    ? await Product.findAll({
        where: { companyId, id: productIds },
        attributes: ["id", "name", "idUniplus"],
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  // Catálogo com código para match por nome (ex.: "Brahma" → "brahma 350")
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
        ])
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  const options = optionIds.length
    ? await ProductVariationOption.findAll({
        where: { id: optionIds },
        attributes: ["id", "idUniplus"],
      })
    : [];
  const optionById = new Map(options.map((o) => [o.id, o]));

  const missingIds: number[] = [];
  const missingNames: string[] = [];
  const unnamed: string[] = [];
  for (const item of items) {
    const codigo = resolveItemUniplusCodigo(
      item,
      byId,
      catalogWithCode,
      optionById
    );
    const nome = String(
      item.productName || item.name || byId.get(Number(item.productId))?.name || ""
    ).trim();
    if (!codigo && !nome) {
      const pid = Number(item.productId);
      if (Number.isFinite(pid) && pid > 0) missingIds.push(pid);
      unnamed.push(String(pid || "?"));
      continue;
    }
    if (!codigo) {
      missingNames.push(nome);
    }
  }

  if (unnamed.length) {
    return {
      ok: false,
      code: "ERR_UNIPLUS_PRODUCT_CODE_MISSING",
      message: `Itens sem código e sem nome: ${[...new Set(unnamed)].join(", ")}`,
      missingProductIds: [...new Set(missingIds)],
      missingProductNames: [...new Set(unnamed)],
    };
  }

  // Sem codigo: ainda despacha — agent resolve por nome no UniPlus
  if (missingNames.length) {
    logger.warn(
      `Uniplus preflight: itens sem idUniplus (agent resolve por nome) companyId=${companyId}: ${[...new Set(missingNames)].join(", ")}`
    );
  }

  return {
    ok: true,
    code: "OK",
    message: usedDeliveryDevice
      ? "preflight ok (device do delivery)"
      : "preflight ok",
    deviceId: printDevice.deviceId,
  };
};

export default ValidateUniplusPreflightService;
