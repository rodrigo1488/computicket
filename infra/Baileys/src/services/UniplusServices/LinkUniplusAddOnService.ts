import AddOnItem from "../../models/AddOnItem";
import AddOnGroup from "../../models/AddOnGroup";
import AppError from "../../errors/AppError";
import { releaseUniplusCodigo } from "./ReleaseUniplusCodigoService";

export interface LinkUniplusAddOnRequest {
  companyId: number;
  codigo: string;
  /** Vincular a item existente */
  addOnItemId?: number;
  /** Criar item novo neste grupo e vincular */
  addOnGroupId?: number;
  label?: string;
  value?: number;
}

export interface LinkUniplusAddOnResult {
  addOnItemId: number;
  label: string;
  created?: boolean;
  removedProductId?: number;
  clearedOptionIds: number[];
}

/**
 * Vincula um codigo UniPlus a um adicional (AddOnItem) existente, ou cria um
 * item novo dentro de um AddOnGroup da company e já grava o idUniplus.
 * Libera o codigo de qualquer vínculo anterior primeiro.
 */
const LinkUniplusAddOnService = async ({
  companyId,
  codigo: rawCodigo,
  addOnItemId,
  addOnGroupId,
  label: rawLabel,
  value: rawValue,
}: LinkUniplusAddOnRequest): Promise<LinkUniplusAddOnResult> => {
  const codigo = String(rawCodigo || "").trim().slice(0, 20);
  if (!codigo) {
    throw new AppError("ERR_UNIPLUS_ATTACH_CODIGO_REQUIRED", 400);
  }

  const itemId = Number(addOnItemId);
  const groupId = Number(addOnGroupId);
  const createMode =
    Number.isFinite(groupId) &&
    groupId > 0 &&
    (!Number.isFinite(itemId) || itemId <= 0);

  let addOnItem: AddOnItem | null = null;
  let created = false;

  if (createMode) {
    const group = await AddOnGroup.findOne({
      where: { id: groupId, companyId },
      attributes: ["id", "companyId"],
    });
    if (!group) {
      throw new AppError("ERR_UNIPLUS_ADDON_GROUP_NOT_FOUND", 404);
    }

    const label = String(rawLabel || "").trim();
    if (!label) {
      throw new AppError("ERR_UNIPLUS_ADDON_LABEL_REQUIRED", 400);
    }

    const value =
      rawValue != null && Number.isFinite(Number(rawValue))
        ? Number(rawValue)
        : 0;

    addOnItem = await AddOnItem.create({
      addOnGroupId: group.id,
      addOnSubgroupId: null,
      label,
      value,
      order: 0,
      idUniplus: null,
    });
    created = true;
  } else {
    if (!Number.isFinite(itemId) || itemId <= 0) {
      throw new AppError("ERR_UNIPLUS_ADDON_ID_REQUIRED", 400);
    }

    addOnItem = await AddOnItem.findOne({
      where: { id: itemId },
      include: [
        {
          model: AddOnGroup,
          required: true,
          where: { companyId },
          attributes: ["id", "companyId"],
        },
      ],
    });
    if (!addOnItem) {
      throw new AppError("ERR_UNIPLUS_ADDON_NOT_FOUND", 404);
    }
  }

  const released = await releaseUniplusCodigo(companyId, codigo, {
    exceptAddOnItemId: addOnItem.id,
  });

  addOnItem.idUniplus = codigo;
  await addOnItem.save();

  return {
    addOnItemId: addOnItem.id,
    label: addOnItem.label,
    created,
    removedProductId: released.removedProductId,
    clearedOptionIds: released.clearedOptionIds,
  };
};

export default LinkUniplusAddOnService;
