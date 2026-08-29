import { Op, fn, col, where, Sequelize } from "sequelize";
import HelpArticle from "../../models/HelpArticle";
import { isEmpty } from "lodash";

interface Request {
  searchParam?: string;
  category?: string;
  pageNumber?: string;
}

interface Response {
  records: HelpArticle[];
  count: number;
  hasMore: boolean;
}

const ListService = async ({
  searchParam = "",
  category,
  pageNumber = "1"
}: Request): Promise<Response> => {
  let whereCondition: any = {
    isActive: true
  };

  // Filtro por categoria
  if (category && !isEmpty(category)) {
    whereCondition.category = category;
  }

  // Busca por palavras-chave, título ou conteúdo
  if (!isEmpty(searchParam)) {
    const searchLower = searchParam.toLowerCase().trim();
    whereCondition = {
      ...whereCondition,
      [Op.or]: [
        {
          title: where(
            fn("LOWER", col("HelpArticle.title")),
            "LIKE",
            `%${searchLower}%`
          )
        },
        {
          content: where(
            fn("LOWER", col("HelpArticle.content")),
            "LIKE",
            `%${searchLower}%`
          )
        },
        {
          keywords: where(
            fn("LOWER", col("HelpArticle.keywords")),
            "LIKE",
            `%${searchLower}%`
          )
        },
        {
          summary: where(
            fn("LOWER", col("HelpArticle.summary")),
            "LIKE",
            `%${searchLower}%`
          )
        }
      ]
    };
  }

  const limit = 50; // Mais artigos por página já que são textos
  const offset = limit * (+pageNumber - 1);

  const { count, rows: records } = await HelpArticle.findAndCountAll({
    where: whereCondition,
    limit,
    offset,
    order: [["order", "ASC"], ["createdAt", "DESC"]]
  });

  const hasMore = count > offset + records.length;

  return {
    records,
    count,
    hasMore
  };
};

export default ListService;
