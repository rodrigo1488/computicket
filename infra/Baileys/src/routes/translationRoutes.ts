import express from "express";
import * as TranslationController from "../controllers/TranslationController";
import isAuth from "../middleware/isAuth";

const routes = express.Router();

// Traduzir mensagem específica
routes.post("/translation/message/:messageId", isAuth, TranslationController.translateMessage);

// Traduzir múltiplas mensagens em batch (otimização)
routes.post("/translation/messages/batch", isAuth, TranslationController.translateMessagesBatch);

// Traduzir texto diretamente
routes.post("/translation/translate", isAuth, TranslationController.translateText);

// Detectar idioma
routes.post("/translation/detect", isAuth, TranslationController.detectLanguage);

// Obter idioma da empresa
routes.get("/translation/company-language", isAuth, TranslationController.getCompanyLanguage);

// Estatísticas do cache (admin)
routes.get("/translation/cache/stats", isAuth, TranslationController.getCacheStats);

// Limpar cache (admin)
routes.post("/translation/cache/clear", isAuth, TranslationController.clearCache);

export default routes;
