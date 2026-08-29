import HelpArticle from "../../models/HelpArticle";
import AppError from "../../errors/AppError";

interface Request {
  id: number;
  title?: string;
  content?: string;
  summary?: string;
  keywords?: string;
  category?: string;
  order?: number;
  isActive?: boolean;
  companyId: number;
}

const UpdateService = async (data: Request): Promise<HelpArticle> => {
  // Validar que apenas empresa ID 1 pode atualizar
  if (data.companyId !== 1) {
    throw new AppError("Apenas a empresa administradora pode atualizar artigos", 403);
  }

  const article = await HelpArticle.findByPk(data.id);

  if (!article) {
    throw new AppError("ERR_NO_HELP_ARTICLE_FOUND", 404);
  }

  await article.update({
    title: data.title,
    content: data.content,
    summary: data.summary,
    keywords: data.keywords,
    category: data.category,
    order: data.order,
    isActive: data.isActive
  });

  return article;
};

export default UpdateService;
