import express from "express";
import multer from "multer";
import isAuth from "../middleware/isAuth";
import hasCompanyModule from "../middleware/hasCompanyModule";
import uploadProductImage from "../config/uploadProductImage";
import uploadMenuFile from "../config/uploadMenuFile";

import * as ProductController from "../controllers/ProductController";

const routes = express.Router();
const upload = multer(uploadProductImage);
const uploadMenu = multer(uploadMenuFile);
const requireLanchonetes = hasCompanyModule("lanchonetes");

routes.get("/products", isAuth, requireLanchonetes, ProductController.index);
routes.post("/products", isAuth, requireLanchonetes, ProductController.store);
routes.post("/products/upload-image", isAuth, requireLanchonetes, upload.single("image"), ProductController.uploadImage);
routes.post("/products/import-from-menu", isAuth, requireLanchonetes, uploadMenu.single("file"), ProductController.importFromMenu);
routes.post("/products/import-from-menu/confirm", isAuth, requireLanchonetes, ProductController.confirmImportFromMenu);
routes.post("/products/:id/duplicate", isAuth, requireLanchonetes, ProductController.duplicate);
routes.get("/products/:id", isAuth, requireLanchonetes, ProductController.show);
routes.put("/products/:id", isAuth, requireLanchonetes, ProductController.update);
routes.delete("/products/:id", isAuth, requireLanchonetes, ProductController.destroy);

// Public route for menu products (no auth required)
routes.get("/public/forms/:publicId/products", ProductController.getPublicMenuProducts);

export default routes;
