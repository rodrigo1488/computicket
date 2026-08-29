import express from "express";
import isAuth from "../middleware/isAuth";
import isCompanyOne from "../middleware/isCompanyOne";
import multer from "multer";
import uploadHelpArticleConfig from "../config/uploadHelpArticle";

import * as HelpArticleController from "../controllers/HelpArticleController";

const upload = multer(uploadHelpArticleConfig);

const routes = express.Router();

// Rotas públicas (todas empresas podem ver)
routes.get("/help-articles", isAuth, HelpArticleController.index);
routes.get("/help-articles/:id", isAuth, HelpArticleController.show);

// Rotas protegidas (apenas empresa 1)
routes.post("/help-articles", isAuth, isCompanyOne, HelpArticleController.store);
routes.put("/help-articles/:id", isAuth, isCompanyOne, HelpArticleController.update);
routes.delete("/help-articles/:id", isAuth, isCompanyOne, HelpArticleController.remove);

// Upload de imagens
routes.post(
  "/help-articles/upload-image",
  isAuth,
  isCompanyOne,
  upload.array("file"),
  HelpArticleController.uploadImage
);

export default routes;
