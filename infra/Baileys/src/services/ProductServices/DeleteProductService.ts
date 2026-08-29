import Product from "../../models/Product";
import AppError from "../../errors/AppError";

interface Request {
  productId: number;
  companyId: number;
}

const DeleteProductService = async ({
  productId,
  companyId,
}: Request): Promise<void> => {
  const product = await Product.findOne({
    where: { id: productId, companyId },
  });

  if (!product) {
    throw new AppError("ERR_PRODUCT_NOT_FOUND", 404);
  }

  await product.destroy();
};

export default DeleteProductService;
