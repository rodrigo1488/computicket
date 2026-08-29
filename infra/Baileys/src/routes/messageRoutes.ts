import { Router } from "express";
import multer from "multer";
import isAuth from "../middleware/isAuth";
import uploadConfig from "../config/upload";
import tokenAuth from "../middleware/tokenAuth";

import * as MessageController from "../controllers/MessageController";

const messageRoutes = Router();

const upload = multer(uploadConfig);

messageRoutes.get("/messages/:ticketId", isAuth, MessageController.index);
messageRoutes.get("/messages/:ticketId/search", isAuth, MessageController.search);
messageRoutes.post("/messages/:ticketId", isAuth, upload.array("medias"), MessageController.store);
messageRoutes.delete("/messages/:messageId", isAuth, MessageController.remove);
messageRoutes.put("/messages/:messageId", isAuth, MessageController.update);
messageRoutes.post("/messages/:messageId/react", isAuth, MessageController.react);
messageRoutes.post("/messages/:messageId/forward", isAuth, MessageController.forward);
messageRoutes.post("/api/messages/send", tokenAuth, upload.array("medias"), MessageController.send);
messageRoutes.post("/messages/send-by-phone", isAuth, MessageController.sendMessageByPhone);
messageRoutes.post(
  "/messages/send-media-by-phone",
  isAuth,
  upload.single("file"),
  MessageController.sendMediaByPhone
);

export default messageRoutes;
