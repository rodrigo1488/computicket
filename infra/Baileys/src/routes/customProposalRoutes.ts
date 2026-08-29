import express from "express";
import isAuth from "../middleware/isAuth";

import * as CustomProposalController from "../controllers/CustomProposalController";

const routes = express.Router();

// Public route - anyone can submit a custom proposal
routes.post("/custom-proposals", CustomProposalController.store);

// Protected routes - only authenticated users (admin) can view proposals
routes.get("/custom-proposals", isAuth, CustomProposalController.index);
routes.get("/custom-proposals/:id", isAuth, CustomProposalController.show);

export default routes;
