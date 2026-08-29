import GrupoAddOn from "../../models/GrupoAddOn";
import AddOnGroup from "../../models/AddOnGroup";
import AppError from "../../errors/AppError";

interface AssignmentInput {
  grupo: string;
  addOnGroupId: number | null;
}

interface Request {
  companyId: number;
  assignments: AssignmentInput[];
}

const UpdateGrupoAssignmentsService = async ({
  companyId,
  assignments,
}: Request): Promise<void> => {
  const validGroups = await AddOnGroup.findAll({
    where: { companyId },
    attributes: ["id"],
  });
  const validIds = new Set(validGroups.map((g) => g.id));

  for (const a of assignments) {
    const grupo = (a.grupo || "").trim();
    if (!grupo) continue;
    if (a.addOnGroupId != null && !validIds.has(a.addOnGroupId)) {
      throw new AppError(`ERR_ADDON_GROUP_NOT_FOUND: ${a.addOnGroupId}`, 404);
    }
  }

  await GrupoAddOn.destroy({
    where: { companyId },
  });

  for (const a of assignments) {
    const grupo = (a.grupo || "").trim();
    if (!grupo || a.addOnGroupId == null) continue;
    await GrupoAddOn.create({
      companyId,
      grupo,
      addOnGroupId: a.addOnGroupId,
    });
  }
};

export default UpdateGrupoAssignmentsService;
