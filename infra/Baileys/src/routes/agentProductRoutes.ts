import { Router } from "express";
import isPrintDeviceAuth from "../middleware/isPrintDeviceAuth";
import * as AgentProductController from "../controllers/AgentProductController";

const routes = Router();

routes.get(
  "/agent/products",
  isPrintDeviceAuth,
  AgentProductController.list
);

routes.post(
  "/agent/products/upsert",
  isPrintDeviceAuth,
  AgentProductController.upsert
);

routes.post(
  "/agent/products/attach-variation",
  isPrintDeviceAuth,
  AgentProductController.attachVariation
);

routes.post(
  "/agent/products/link-standalone",
  isPrintDeviceAuth,
  AgentProductController.linkStandalone
);

routes.post(
  "/agent/products/unlink",
  isPrintDeviceAuth,
  AgentProductController.unlink
);

routes.post(
  "/agent/products/create-parent",
  isPrintDeviceAuth,
  AgentProductController.createParent
);

routes.post(
  "/agent/products/link-addon",
  isPrintDeviceAuth,
  AgentProductController.linkAddOn
);

export default routes;
