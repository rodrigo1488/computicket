import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import { head } from "lodash";

import ListService from "../services/HelpArticleService/ListService";
import CreateService from "../services/HelpArticleService/CreateService";
import ShowService from "../services/HelpArticleService/ShowService";
import UpdateService from "../services/HelpArticleService/UpdateService";
import DeleteService from "../services/HelpArticleService/DeleteService";

import AppError from "../errors/AppError";

type IndexQuery = {
  searchParam?: string;
  category?: string;
  pageNumber?: string;
};

type StoreData = {
  title: string;
  content: string;
  summary?: string;
  keywords?: string;
  category?: string;
  order?: number;
  isActive?: boolean;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, category, pageNumber } = req.query as IndexQuery;

  const { records, count, hasMore } = await ListService({
    searchParam,
    category,
    pageNumber
  });
  return res.json({ records, count, hasMore });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;

  const record = await ShowService(id);

  return res.status(200).json(record);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const data = req.body as StoreData;

  const schema = Yup.object().shape({
    title: Yup.string().required(),
    content: Yup.string().required()
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const record = await CreateService({
    ...data,
    companyId
  });

  const io = getIO();
  io.emit("help-article", {
    action: "create",
    record
  });

  return res.status(200).json(record);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const data = req.body as StoreData;
  const { companyId } = req.user;
  const { id } = req.params;

  const schema = Yup.object().shape({
    title: Yup.string().required(),
    content: Yup.string().required()
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const record = await UpdateService({
    ...data,
    id: parseInt(id),
    companyId
  });

  const io = getIO();
  io.emit("help-article", {
    action: "update",
    record
  });

  return res.status(200).json(record);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  await DeleteService({
    id: parseInt(id),
    companyId
  });

  const io = getIO();
  io.emit("help-article", {
    action: "delete",
    id: parseInt(id)
  });

  return res.status(200).json({ message: "Help article deleted" });
};

export const uploadImage = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const files = req.files as Express.Multer.File[];
  const file = head(files);

  if (!file) {
    throw new AppError("Nenhum arquivo enviado", 400);
  }

  const imageUrl = `/public/help-articles/${file.filename}`;

  return res.status(200).json({
    url: imageUrl,
    filename: file.filename
  });
};
