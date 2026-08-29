import { Request, Response } from "express";
import ListAddOnGroupsService from "../services/AddOnGroupServices/ListAddOnGroupsService";
import CreateAddOnGroupService from "../services/AddOnGroupServices/CreateAddOnGroupService";
import ShowAddOnGroupService from "../services/AddOnGroupServices/ShowAddOnGroupService";
import UpdateAddOnGroupService from "../services/AddOnGroupServices/UpdateAddOnGroupService";
import DeleteAddOnGroupService from "../services/AddOnGroupServices/DeleteAddOnGroupService";
import GetGrupoAssignmentsService from "../services/AddOnGroupServices/GetGrupoAssignmentsService";
import GetAvailableGruposService from "../services/AddOnGroupServices/GetAvailableGruposService";
import UpdateGrupoAssignmentsService from "../services/AddOnGroupServices/UpdateGrupoAssignmentsService";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const groups = await ListAddOnGroupsService({ companyId });
  return res.json(groups);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { name, subgroups, items, required, minItems, maxItems } = req.body;
  const group = await CreateAddOnGroupService({
    companyId,
    name,
    subgroups: subgroups || [],
    items: items || [],
    required,
    minItems,
    maxItems,
  });
  return res.status(201).json(group);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "ERR_INVALID_ID" });
  }
  const group = await ShowAddOnGroupService({ addOnGroupId: id, companyId });
  return res.json(group);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "ERR_INVALID_ID" });
  }
  const { name, subgroups, items, required, minItems, maxItems } = req.body;
  const group = await UpdateAddOnGroupService({
    addOnGroupId: id,
    companyId,
    name,
    subgroups: subgroups ?? [],
    items: items ?? [],
    required,
    minItems,
    maxItems,
  });
  return res.json(group);
};

export const destroy = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const id = Number(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "ERR_INVALID_ID" });
  }
  await DeleteAddOnGroupService({ addOnGroupId: id, companyId });
  return res.status(204).send();
};

export const getGrupoAssignments = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const [assignments, availableGrupos] = await Promise.all([
    GetGrupoAssignmentsService({ companyId }),
    GetAvailableGruposService({ companyId }),
  ]);
  return res.json({ assignments, availableGrupos });
};

export const updateGrupoAssignments = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { assignments } = req.body;
  if (!Array.isArray(assignments)) {
    return res.status(400).json({ error: "ERR_ASSIGNMENTS_ARRAY_REQUIRED" });
  }
  await UpdateGrupoAssignmentsService({ companyId, assignments });
  return res.status(204).send();
};
