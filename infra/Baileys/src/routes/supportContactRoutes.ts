import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as SupportContactController from "../controllers/SupportContactController";

const supportContactRoutes = Router();

supportContactRoutes.get("/support-folders", isAuth, SupportContactController.indexFolders);
supportContactRoutes.post("/support-folders", isAuth, SupportContactController.storeFolder);
supportContactRoutes.put(
  "/support-folders/:folderId",
  isAuth,
  SupportContactController.editFolder
);
supportContactRoutes.delete(
  "/support-folders/:folderId",
  isAuth,
  SupportContactController.destroyFolder
);

supportContactRoutes.get("/support-contacts", isAuth, SupportContactController.indexContacts);
supportContactRoutes.post("/support-contacts", isAuth, SupportContactController.storeContact);
supportContactRoutes.put(
  "/support-contacts/:contactId",
  isAuth,
  SupportContactController.editContact
);
supportContactRoutes.delete(
  "/support-contacts/:contactId",
  isAuth,
  SupportContactController.destroyContact
);
supportContactRoutes.post(
  "/support-contacts/:contactId/conversation",
  isAuth,
  SupportContactController.openConversation
);
supportContactRoutes.get(
  "/support-tickets/:ticketId",
  isAuth,
  SupportContactController.showConversation
);

export default supportContactRoutes;
