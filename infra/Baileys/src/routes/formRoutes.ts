import express from "express";
import multer from "multer";
import isAuth from "../middleware/isAuth";
import optionalAuth from "../middleware/optionalAuth";
import uploadFormLogo from "../config/uploadFormLogo";

import * as FormController from "../controllers/FormController";
import * as FormResponseController from "../controllers/FormResponseController";
import * as AppointmentController from "../controllers/AppointmentController";

const routes = express.Router();
const upload = multer(uploadFormLogo);

// Orders - centralized Kanban (all cardapio forms)
routes.get("/orders", isAuth, FormResponseController.listAllOrders);
routes.get("/orders/unconfirmed-counts", isAuth, FormResponseController.unconfirmedOrderCounts);

// Authenticated routes - Forms management
routes.get("/forms", isAuth, FormController.index);
routes.post(
  "/forms/upload-logo",
  isAuth,
  (req, res, next) => {
    upload.single("logo")(req, res, (err: any) => {
      if (err) {
        return res.status(400).json({ error: err.message || "Arquivo inválido. Use JPEG, PNG, GIF ou WEBP (máx. 2MB)." });
      }
      next();
    });
  },
  FormController.uploadLogo
);
routes.post("/forms", isAuth, FormController.store);
routes.post("/forms/import", isAuth, FormController.importForm);
routes.get("/forms/:id", isAuth, FormController.show);
routes.put("/forms/:id", isAuth, FormController.update);
routes.delete("/forms/:id", isAuth, FormController.destroy);
routes.post("/forms/:id/duplicate", isAuth, FormController.duplicate);
routes.get("/forms/:id/stats", isAuth, FormController.getStats);
routes.get("/forms/:id/export", isAuth, FormController.exportForm);

// Responses management
routes.get("/forms/:formId/responses", isAuth, FormResponseController.index);
routes.get("/forms/:formId/orders", isAuth, FormResponseController.listOrders);
routes.get("/forms/:formId/responses/:id", isAuth, FormResponseController.show);
routes.delete("/forms/:formId/responses/:id", isAuth, FormResponseController.destroy);
routes.put("/forms/:formId/responses/:id/read", isAuth, FormResponseController.markAsRead);
routes.put("/forms/:formId/responses/:id/star", isAuth, FormResponseController.toggleStar);
routes.put("/forms/:formId/responses/:id/order-status", isAuth, FormResponseController.updateOrderStatus);
routes.put("/forms/:formId/responses/:id/delivery-order", isAuth, FormResponseController.updateDeliveryOrder);
routes.post(
  "/forms/:formId/responses/:id/reprint-print",
  isAuth,
  FormResponseController.reprintPrint
);
routes.get("/forms/:formId/analytics", isAuth, FormResponseController.getAnalytics);
routes.get("/forms/:formId/export", isAuth, FormResponseController.exportData);

// Public routes (no auth)
routes.get("/public/forms/:publicId/appointment-services", AppointmentController.getPublicAppointmentServices);
routes.get("/public/forms/:publicId/availability", AppointmentController.getAvailability);
routes.get("/public/forms/:publicId/appointments/by-token", AppointmentController.getByToken);
routes.get("/public/forms/:publicId/appointments/ical", AppointmentController.getIcalByToken);
routes.put("/public/forms/:publicId/appointments/cancel", AppointmentController.cancelByToken);
routes.put("/public/forms/:publicId/appointments/reschedule", AppointmentController.rescheduleByToken);
routes.post("/public/forms/:publicId/waitlist", AppointmentController.addToWaitlist);
routes.get("/public/forms/:publicId", FormController.getPublicForm);
routes.get("/public/forms/:publicId/most-ordered", FormController.getPublicMostOrdered);
routes.get("/public/forms/:publicId/repeat-data", FormController.getPublicRepeatData);
routes.post("/public/forms/:publicId/submit", optionalAuth, FormResponseController.store);
routes.get("/public/orders/:token", FormResponseController.getPublicOrderStatus);

export default routes;
