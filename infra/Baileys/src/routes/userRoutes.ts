import { Router } from "express";
import multer from "multer";

import isAuth from "../middleware/isAuth";
import * as UserController from "../controllers/UserController";
import uploadUserAvatarConfig from "../config/uploadUserAvatar";

const userRoutes = Router();
const upload = multer(uploadUserAvatarConfig);

userRoutes.get("/users", isAuth, UserController.index);

userRoutes.get(
  "/users/page-permissions",
  isAuth,
  UserController.pagePermissionsCatalog
);

userRoutes.get("/users/list", isAuth, UserController.list);

userRoutes.post("/users", isAuth, UserController.store);

userRoutes.put("/users/:userId", isAuth, UserController.update);

userRoutes.put("/users/:userId/active", isAuth, UserController.setActive);

userRoutes.get("/users/:userId", isAuth, UserController.show);

userRoutes.get("/users/:userId/contacts", isAuth, UserController.getContacts);

userRoutes.delete("/users/:userId", isAuth, UserController.remove);

userRoutes.post("/users/set-language/:newLanguage", isAuth, UserController.setLanguage);

userRoutes.put("/users/:userId/availability-settings", isAuth, UserController.updateAvailabilitySettings);

userRoutes.get("/users/:userId/availability-settings", isAuth, UserController.getAvailabilitySettings);

userRoutes.post(
  "/users/:userId/avatar", 
  isAuth, 
  (req, res, next) => {
    upload.single("avatar")(req, res, (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  UserController.uploadAvatar
);

export default userRoutes;
