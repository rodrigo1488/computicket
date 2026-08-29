import { Router } from "express";
import isAuth from "../middleware/isAuth";
import * as GupshupValidationController from "../controllers/GupshupValidationController";

const gupshupValidationRoutes = Router();

// Validar conexão Gupshup existente
gupshupValidationRoutes.post(
  "/gupshup/validate/:whatsappId",
  isAuth,
  GupshupValidationController.validateConnection
);

// Testar credenciais Gupshup sem salvar
gupshupValidationRoutes.post(
  "/gupshup/test-credentials",
  isAuth,
  GupshupValidationController.testCredentials
);

export default gupshupValidationRoutes;

