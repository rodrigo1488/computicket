import HelpArticle from "../../models/HelpArticle";
import AppError from "../../errors/AppError";

interface Request {
  title: string;
  content: string;
  summary?: string;
  keywords?: string;
  category?: string;
  order?: number;
  isActive?: boolean;
  companyId: number;
}

const CreateService = async (data: Request): Promise<HelpArticle> => {
  // Validar que apenas empresa ID 1 pode criar
  if (data.companyId !== 1) {
    throw new AppError("Apenas a empresa administradora pode criar artigos", 403);
  }

  const article = await HelpArticle.create({
    title: data.title,
    content: data.content,
    summary: data.summary || "",
    keywords: data.keywords || "",
    category: data.category || "Outros",
    order: data.order || 0,
    isActive: data.isActive !== undefined ? data.isActive : true,
    createdByCompanyId: 1
  });

  return article;
};

export default CreateService;
