import moment from "moment";
import Company from "../models/Company";
import AppError from "../errors/AppError";

/** Mesma regra do frontend (Route.js): vencido no dia seguinte ao dueDate. */
export const isCompanySubscriptionExpired = (
  dueDate: string | Date | null | undefined
): boolean => {
  if (!dueDate) return false;
  const due = moment(dueDate);
  if (!due.isValid()) return false;
  const today = moment().startOf("day");
  return today.isAfter(due.startOf("day"));
};

export const isCompanyActiveForPublicAccess = (
  status: boolean | null | undefined
): boolean => status !== false;

export const assertCompanyPublicAccess = async (
  companyId: number
): Promise<void> => {
  const company = await Company.findByPk(companyId, {
    attributes: ["id", "status", "dueDate"],
  });

  if (!company) {
    throw new AppError("ERR_COMPANY_NOT_FOUND", 404);
  }

  if (!isCompanyActiveForPublicAccess(company.status)) {
    throw new AppError("ERR_PUBLIC_FORM_COMPANY_UNAVAILABLE", 403);
  }

  if (isCompanySubscriptionExpired(company.dueDate)) {
    throw new AppError("ERR_PUBLIC_FORM_COMPANY_UNAVAILABLE", 403);
  }
};
