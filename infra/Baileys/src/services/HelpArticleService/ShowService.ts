import HelpArticle from "../../models/HelpArticle";
import AppError from "../../errors/AppError";

const ShowService = async (id: string | number): Promise<HelpArticle> => {
  const record = await HelpArticle.findByPk(id);

  if (!record) {
    throw new AppError("ERR_NO_HELP_ARTICLE_FOUND", 404);
  }

  return record;
};

export default ShowService;
