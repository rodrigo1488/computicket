import express from "express";
import isAuth from "../middleware/isAuth";

import * as TicketController from "../controllers/TicketController";
import * as TicketHistoryController from "../controllers/TicketHistoryController";

const ticketRoutes = express.Router();

ticketRoutes.get("/tickets/history", isAuth, TicketHistoryController.index);
ticketRoutes.get("/tickets/history/search", isAuth, TicketHistoryController.search);
ticketRoutes.get(
  "/tickets/history/contact/:contactId/timeline",
  isAuth,
  TicketHistoryController.contactTimeline
);
ticketRoutes.get(
  "/tickets/history/contact/:contactId",
  isAuth,
  TicketHistoryController.contactSessions
);

ticketRoutes.get("/tickets", isAuth, TicketController.index);

ticketRoutes.get("/tickets/overview", isAuth, TicketController.overview);

ticketRoutes.get("/tickets/:ticketId", isAuth, TicketController.show);
ticketRoutes.get("/tickets/:ticketId/group-participants", isAuth, TicketController.groupParticipants);

ticketRoutes.get("/ticket/kanban", isAuth, TicketController.kanban);

ticketRoutes.get("/tickets/u/:uuid", isAuth, TicketController.showFromUUID);

ticketRoutes.post("/tickets", isAuth, TicketController.store);

ticketRoutes.post("/tickets/bulk-close", isAuth, TicketController.bulkClose);

ticketRoutes.put("/tickets/:ticketId", isAuth, TicketController.update);
ticketRoutes.put("/tickets/:ticketId/mark-unread", isAuth, TicketController.markAsUnread);

ticketRoutes.delete("/tickets/:ticketId", isAuth, TicketController.remove);

export default ticketRoutes;
