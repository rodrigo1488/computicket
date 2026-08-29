import { Router } from "express";
import isAuth from "../middleware/isAuth";

import * as UserQuickButtonController from "../controllers/UserQuickButtonController";

const userQuickButtonRoutes = Router();

userQuickButtonRoutes.get("/user-quick-buttons", isAuth, UserQuickButtonController.index);
userQuickButtonRoutes.post("/user-quick-buttons", isAuth, UserQuickButtonController.store);
userQuickButtonRoutes.put("/user-quick-buttons/:id", isAuth, UserQuickButtonController.update);
userQuickButtonRoutes.delete("/user-quick-buttons/:id", isAuth, UserQuickButtonController.remove);
userQuickButtonRoutes.put("/user-quick-buttons/reorder", isAuth, UserQuickButtonController.reorder);

export default userQuickButtonRoutes;
