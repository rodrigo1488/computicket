import { Request, Response } from "express";
import * as Yup from "yup";
import AppError from "../errors/AppError";
import ListUserQuickButtonsService from "../services/UserQuickButtonServices/ListUserQuickButtonsService";
import CreateUserQuickButtonService from "../services/UserQuickButtonServices/CreateUserQuickButtonService";
import UpdateUserQuickButtonService from "../services/UserQuickButtonServices/UpdateUserQuickButtonService";
import DeleteUserQuickButtonService from "../services/UserQuickButtonServices/DeleteUserQuickButtonService";
import ReorderUserQuickButtonsService from "../services/UserQuickButtonServices/ReorderUserQuickButtonsService";

interface ButtonData {
  label: string;
  route: string;
  icon?: string;
  color?: string;
  order?: number;
  isVisible?: boolean;
}

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: visitorId } = req.user;
  const userId = Number(visitorId);
  const { includeHidden } = req.query;

  const { buttons } = await ListUserQuickButtonsService({
    companyId,
    userId,
    includeHidden: includeHidden === "true",
  });

  return res.json({ buttons });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: visitorId } = req.user;
  const userId = Number(visitorId);
  const buttonData: ButtonData = req.body;

  const schema = Yup.object().shape({
    label: Yup.string().required(),
    route: Yup.string().required(),
    icon: Yup.string().nullable(),
    color: Yup.string().nullable(),
    order: Yup.number().nullable(),
    isVisible: Yup.boolean().nullable(),
  });

  try {
    await schema.validate(buttonData);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const { button } = await CreateUserQuickButtonService({
    ...buttonData,
    companyId,
    userId,
  });

  return res.status(201).json(button);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: visitorId } = req.user;
  const userId = Number(visitorId);
  const { id } = req.params;
  const buttonData: Partial<ButtonData> = req.body;

  const schema = Yup.object().shape({
    label: Yup.string().nullable(),
    route: Yup.string().nullable(),
    icon: Yup.string().nullable(),
    color: Yup.string().nullable(),
    order: Yup.number().nullable(),
    isVisible: Yup.boolean().nullable(),
  });

  try {
    await schema.validate(buttonData);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const { button } = await UpdateUserQuickButtonService({
    companyId,
    userId,
    buttonId: Number(id),
    ...buttonData,
  });

  return res.json(button);
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: visitorId } = req.user;
  const userId = Number(visitorId);
  const { id } = req.params;

  await DeleteUserQuickButtonService({
    companyId,
    userId,
    buttonId: Number(id),
  });

  return res.status(204).json({});
};

export const reorder = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: visitorId } = req.user;
  const userId = Number(visitorId);
  const { buttons } = req.body;

  const schema = Yup.object().shape({
    buttons: Yup.array()
      .of(
        Yup.object().shape({
          id: Yup.number().required(),
          order: Yup.number().required(),
        })
      )
      .required(),
  });

  try {
    await schema.validate({ buttons });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  await ReorderUserQuickButtonsService({
    companyId,
    userId,
    buttons,
  });

  return res.json({ message: "Botões reordenados com sucesso" });
};
