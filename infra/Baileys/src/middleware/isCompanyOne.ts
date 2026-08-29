import { Request, Response, NextFunction } from "express";
import AppError from "../errors/AppError";

const isCompanyOne = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const { companyId } = req.user;
  
  if (companyId !== 1) {
    throw new AppError(
      "Apenas a empresa administradora pode realizar esta ação",
      403
    );
  }

  return next();
};

export default isCompanyOne;
