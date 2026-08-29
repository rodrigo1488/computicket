import Form from "../../models/Form";
import User from "../../models/User";
import AppError from "../../errors/AppError";
import CreateFormService from "./CreateFormService";
import HasCompanyModuleService, { MODULE_LANCHONETES } from "../CompanyModuleServices/HasCompanyModuleService";

interface Request {
  companyId: number;
  createdBy?: number;
}

const resolveFormCreatorUserId = async (
  companyId: number,
  createdBy?: number
): Promise<number> => {
  if (createdBy && createdBy > 0) {
    const user = await User.findOne({
      where: { id: createdBy, companyId },
      attributes: ["id"],
    });
    if (user) return user.id;
  }

  const fallbackUser = await User.findOne({
    where: { companyId },
    attributes: ["id"],
    order: [["id", "ASC"]],
  });
  if (!fallbackUser) {
    throw new AppError("Nenhum usuário encontrado na empresa para criar o formulário de cardápio.", 400);
  }
  return fallbackUser.id;
};

/**
 * Retorna o primeiro formulário de cardápio ativo da empresa.
 * Se não existir nenhum, cria um formulário "Cardápio" (desde que o módulo Lanchonetes esteja ativo).
 * Usado para mesas sem cardápio vinculado e para fallback no painel.
 */
const GetOrCreateDefaultCardapioFormService = async ({
  companyId,
  createdBy,
}: Request): Promise<Form> => {
  const cardapioForms = await Form.findAll({
    where: { companyId, isActive: true },
    attributes: ["id", "slug", "companyId", "name", "settings"],
  });
  const firstCardapio = cardapioForms.find(
    (f) => (f.settings as any)?.formType === "cardapio"
  );
  if (firstCardapio) {
    return firstCardapio;
  }

  const hasModule = await HasCompanyModuleService(companyId, MODULE_LANCHONETES);
  if (!hasModule) {
    throw new AppError(
      "Configure o módulo Lanchonetes ou crie um formulário de cardápio na empresa.",
      404
    );
  }

  const resolvedCreatedBy = await resolveFormCreatorUserId(companyId, createdBy);

  const form = await CreateFormService({
    name: "Cardápio",
    companyId,
    createdBy: resolvedCreatedBy,
    settings: { formType: "cardapio" },
  });

  return form;
};

export default GetOrCreateDefaultCardapioFormService;
