import express from "express";
import isAuth from "../middleware/isAuth";
import hasCompanyModule from "../middleware/hasCompanyModule";
import * as AddOnGroupController from "../controllers/AddOnGroupController";

const routes = express.Router();
const requireLanchonetes = hasCompanyModule("lanchonetes");

routes.get("/addon-groups", isAuth, requireLanchonetes, AddOnGroupController.index);
routes.post("/addon-groups", isAuth, requireLanchonetes, AddOnGroupController.store);
routes.get("/addon-groups/grupo-assignments", isAuth, requireLanchonetes, AddOnGroupController.getGrupoAssignments);
routes.put("/addon-groups/grupo-assignments", isAuth, requireLanchonetes, AddOnGroupController.updateGrupoAssignments);
routes.get("/addon-groups/:id", isAuth, requireLanchonetes, AddOnGroupController.show);
routes.put("/addon-groups/:id", isAuth, requireLanchonetes, AddOnGroupController.update);
routes.delete("/addon-groups/:id", isAuth, requireLanchonetes, AddOnGroupController.destroy);

export default routes;
