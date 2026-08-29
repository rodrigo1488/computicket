import HelpArticle from "../../models/HelpArticle";
import AppError from "../../errors/AppError";

interface Request {
  id: number;
  companyId: number;
}

const DeleteService = async (data: Request): Promise<void> => {
  // Validar que apenas empresa ID 1 pode deletar
  if (data.companyId !== 1) {
    throw new AppError("Apenas a empresa administradora pode deletar artigos", 403);
  }

  const article = await HelpArticle.findByPk(data.id);

  if (!article) {
    throw new AppError("ERR_NO_HELP_ARTICLE_FOUND", 404);
  }

  await article.destroy();
};

export default DeleteService;
