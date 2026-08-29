import GrupoAddOn from "../../models/GrupoAddOn";
import AddOnGroup from "../../models/AddOnGroup";

interface Request {
  companyId: number;
}

export interface GrupoAssignment {
  grupo: string;
  addOnGroupId: number | null;
  addOnGroupName?: string | null;
}

const GetGrupoAssignmentsService = async ({
  companyId,
}: Request): Promise<GrupoAssignment[]> => {
  const assignments = await GrupoAddOn.findAll({
    where: { companyId },
    include: [{ model: AddOnGroup, as: "addOnGroup", attributes: ["id", "name"] }],
  });
  return assignments.map((a) => ({
    grupo: a.grupo,
    addOnGroupId: a.addOnGroupId,
    addOnGroupName: (a as any).addOnGroup?.name ?? null,
  }));
};

export default GetGrupoAssignmentsService;
