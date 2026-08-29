import Form from "../../models/Form";
import AppError from "../../errors/AppError";

interface Request {
  formId: number;
  companyId: number;
}

const DeleteFormService = async ({
  formId,
  companyId,
}: Request): Promise<void> => {
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  await form.destroy();
};

export default DeleteFormService;
