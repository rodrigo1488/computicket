import express from "express";
import isAuth from "../middleware/isAuth";
import validateAIApiKey from "../middleware/validateAIApiKey";
import * as AiSummaryController from "../controllers/AiSummaryController";
import * as ChatAIController from "../controllers/ChatAIController";
import * as CampaignAIController from "../controllers/CampaignAIController";
import * as AiJobController from "../controllers/AiJobController";
import uploadAudioMemory from "../config/uploadAudioMemory";

const routes = express.Router();

// Rotas de configuração de providers
routes.get("/ai/providers/config", isAuth, AiSummaryController.getProviderConfigurations);
routes.post("/ai/providers/config", isAuth, AiSummaryController.setProviderConfiguration);
routes.get("/ai/providers/status", isAuth, AiSummaryController.getProvidersStatus);
routes.post("/ai/providers/test-gemini", isAuth, AiSummaryController.testGeminiApiKey);

// Rotas de configuração do chat IA (somente leitura; valores fixos no servidor)
routes.get("/ai/chat/config", isAuth, AiSummaryController.getChatConfig);

// Todas as outras rotas de IA precisam validar a API key antes de acessar (agora genérico - Gemini ou OpenAI)
routes.post("/ai/summary/agent", isAuth, validateAIApiKey, AiSummaryController.agentSummary);
routes.post("/ai/chat", isAuth, validateAIApiKey, AiSummaryController.chat);
routes.post("/ai/chat/audio", isAuth, validateAIApiKey, uploadAudioMemory.single("audio"), AiSummaryController.chatWithAudio);
routes.post("/ai/dashboard/command", isAuth, validateAIApiKey, AiSummaryController.dashboardCommand);

// Rotas para IA no chat
routes.post("/chat-ai/analyze", isAuth, validateAIApiKey, ChatAIController.analyze);
routes.post("/chat-ai/audio-summary", isAuth, validateAIApiKey, ChatAIController.audioSummary);
routes.post("/chat-ai/improve", isAuth, validateAIApiKey, ChatAIController.improve);
routes.post("/chat-ai/apply-reply-actions", isAuth, validateAIApiKey, ChatAIController.applyReplyActions);
routes.post("/chat-ai/transcribe/:messageId", isAuth, validateAIApiKey, ChatAIController.transcribe);
routes.post("/chat-ai/generate-ticket", isAuth, validateAIApiKey, ChatAIController.generateTicket);

// Fila de jobs de IA em segundo plano
routes.post("/ai/jobs", isAuth, validateAIApiKey, AiJobController.startJob);
routes.get("/ai/jobs/:jobId", isAuth, AiJobController.getJobStatus);

// Rotas para IA em campanhas
routes.post("/ai/campaign/initial", isAuth, validateAIApiKey, CampaignAIController.generateCampaignInitialMessage);
routes.post("/ai/campaign/variations", isAuth, validateAIApiKey, CampaignAIController.generateCampaignVariations);

export default routes;


