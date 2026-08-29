import express, { Request, Response, NextFunction } from "express";
import isAuth from "../middleware/isAuth";
import AppError from "../errors/AppError";
import * as WhatsAppImportController from "../controllers/WhatsAppImportController";
import { whatsappImportUpload } from "../config/whatsappImportUpload";

const whatsappImportRoutes = express.Router();

const uploadSingle = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  whatsappImportUpload.single("file")(req, res, (err: unknown) => {
    const uploadErr = err as { code?: string } | undefined;
    if (uploadErr?.code === "LIMIT_FILE_SIZE") {
      next(new AppError("ERR_WHATSAPP_IMPORT_FILE_TOO_LARGE", 400));
      return;
    }
    if (err) {
      next(err as Error);
      return;
    }
    next();
  });
};

const importHandlers = [isAuth, uploadSingle, WhatsAppImportController.store];
const previewHandlers = [isAuth, uploadSingle, WhatsAppImportController.preview];

whatsappImportRoutes.post("/whatsapp-import", ...importHandlers);
whatsappImportRoutes.post("/contacts/import-whatsapp", ...importHandlers);
whatsappImportRoutes.post(
  "/contacts/import-whatsapp/preview",
  ...previewHandlers
);

export default whatsappImportRoutes;
