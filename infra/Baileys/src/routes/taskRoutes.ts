import { Router } from "express";
import isAuth from "../middleware/isAuth";

import * as TaskController from "../controllers/TaskController";

const taskRoutes = Router();

taskRoutes.get("/tasks", isAuth, TaskController.index);
taskRoutes.get("/tasks/stats", isAuth, TaskController.stats);
taskRoutes.get("/tasks/:taskId", isAuth, TaskController.show);
taskRoutes.post("/tasks", isAuth, TaskController.store);
taskRoutes.put("/tasks/:taskId", isAuth, TaskController.update);
taskRoutes.delete("/tasks/:taskId", isAuth, TaskController.remove);

export default taskRoutes;

