import express from "express";
import multer from "multer";
import isAuth from "../middleware/isAuth";
import uploadChatMediaConfig from "../config/uploadChatMedia";

import * as ChatController from "../controllers/ChatController";

const routes = express.Router();
const upload = multer(uploadChatMediaConfig);

routes.get("/chats", isAuth, ChatController.index);

routes.get("/chats/:id", isAuth, ChatController.show);

routes.get("/chats/:id/messages", isAuth, ChatController.messages);

routes.post("/chats/:id/messages", isAuth, upload.single("media"), ChatController.saveMessage);

routes.post("/chats/:id/read", isAuth, ChatController.checkAsRead);

routes.post("/chats", isAuth, ChatController.store);

routes.put("/chats/:id", isAuth, ChatController.update);

routes.delete("/chats/:id", isAuth, ChatController.remove);

export default routes;
