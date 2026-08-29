import Product from "../../models/Product";
import { Op } from "sequelize";
import { productDetailInclude } from "./SyncProductComboItems";

const productInclude = productDetailInclude;

interface Request {
  companyId: number;
  searchParam?: string;
  pageNumber?: number;
  isMenuProduct?: boolean;
  grupo?: string;
}

interface Response {
  products: Product[];
  count: number;
  hasMore: boolean;
  groups?: string[];
}

const ListProductsService = async ({
  companyId,
  searchParam,
  pageNumber = 1,
  isMenuProduct,
  grupo,
}: Request): Promise<Response> => {
  const whereCondition: any = { companyId };

  if (searchParam) {
    whereCondition[Op.or] = [
      { name: { [Op.iLike]: `%${searchParam}%` } },
      { description: { [Op.iLike]: `%${searchParam}%` } },
      { grupo: { [Op.iLike]: `%${searchParam}%` } },
    ];
  }

  if (isMenuProduct !== undefined) {
    whereCondition.isMenuProduct = isMenuProduct;
  }

  if (grupo !== undefined && grupo !== null && grupo !== "") {
    whereCondition.grupo = grupo;
  }

  const limit = 20;
  const offset = (pageNumber - 1) * limit;

  const { count, rows: products } = await Product.findAndCountAll({
    where: whereCondition,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
    include: productInclude,
  });

  const groupsResult = await Product.findAll({
    where: { companyId },
    attributes: ["grupo"],
    raw: true,
  });
  const groups = [...new Set((groupsResult.map((r) => r.grupo).filter((g) => g != null && g.trim() !== "")))].sort();

  return {
    products,
    count,
    hasMore: count > offset + limit,
    groups,
  };
};

export default ListProductsService;
