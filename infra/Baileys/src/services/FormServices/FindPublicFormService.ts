import { FindOptions } from "sequelize";
import Form from "../../models/Form";
import AppError from "../../errors/AppError";
import { assertCompanyPublicAccess } from "../../helpers/companyPublicAccess";

type PublicFormFindOptions = Omit<FindOptions, "where">;

/** Garante companyId (e id) quando o caller restringe attributes. */
const withPublicAccessAttributes = (
  options: PublicFormFindOptions
): PublicFormFindOptions => {
  if (!Array.isArray(options.attributes)) {
    return options;
  }
  const attrs = new Set(
    (options.attributes as Array<string | unknown>)
      .map((a) => (typeof a === "string" ? a : null))
      .filter((a): a is string => Boolean(a))
  );
  attrs.add("id");
  attrs.add("companyId");
  return { ...options, attributes: Array.from(attrs) };
};

export const findPublicFormBySlug = async (
  publicId: string,
  options: PublicFormFindOptions = {}
): Promise<Form> => {
  const form = await Form.findOne({
    where: { publicId, isActive: true },
    ...withPublicAccessAttributes(options),
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  await assertCompanyPublicAccess(form.companyId);
  return form;
};

export const findPublicFormById = async (
  id: number,
  options: PublicFormFindOptions = {}
): Promise<Form> => {
  const form = await Form.findOne({
    where: { id, isActive: true },
    ...withPublicAccessAttributes(options),
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  await assertCompanyPublicAccess(form.companyId);
  return form;
};
