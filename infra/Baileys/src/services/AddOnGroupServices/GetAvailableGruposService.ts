import Product from "../../models/Product";

interface Request {
  companyId: number;
}

const GetAvailableGruposService = async ({
  companyId,
}: Request): Promise<string[]> => {
  const products = await Product.findAll({
    where: { companyId, isMenuProduct: true },
    attributes: ["grupo"],
    group: ["grupo"],
  });
  const grupos = products
    .map((p) => (p.grupo || "").trim())
    .filter((g) => g !== "");
  return [...new Set(grupos)].sort();
};

export default GetAvailableGruposService;
