import express from "express";
import isAuth from "../middleware/isAuth";
import * as PrintJobController from "../controllers/PrintJobController";

const routes = express.Router();

routes.post("/print-jobs/:jobId/reprint", isAuth, PrintJobController.reprint);
routes.post(
  "/form-responses/:formResponseId/uniplus/reprocess",
  isAuth,
  PrintJobController.reprocessUniplus
);

export default routes;
