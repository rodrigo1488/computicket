import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import CreateTemplatePromptService from "../services/PromptTemplates/CreateTemplatePromptService";
import { AGENT_TEMPLATES } from "../services/PromptTemplates/TemplateDefinitions";
import { verify } from "jsonwebtoken";
import authConfig from "../config/auth";

interface TokenPayload {
  id: string;
  username: string;
  profile: string;
  companyId: number;
  iat: number;
  exp: number;
}

// Listar templates disponíveis
export const listTemplates = async (req: Request, res: Response): Promise<Response> => {
  const templates = Object.values(AGENT_TEMPLATES).map(template => ({
    tipo: template.tipo,
    nome: template.nome,
    descricao: template.descricao,
    permissoes: template.permissoes,
    defaultVariables: template.defaultVariables
  }));

  return res.status(200).json({ templates });
};

// Criar prompt a partir de template
export const createFromTemplate = async (req: Request, res: Response): Promise<Response> => {
  try {
    const authHeader = req.headers.authorization;
    const [, token] = authHeader.split(" ");
    const decoded = verify(token, authConfig.secret);
    const { companyId } = decoded as TokenPayload;

    const {
      tipoAgente,
      model,
      provider,
      queueId,
      maxMessages,
      maxTokens,
      temperature,
      variables,
      canSendInternalMessages,
      canTransferToAgent,
      canChangeTag,
      permitirCriarAgendamentos,
      businessHours
    } = req.body;

    if (!tipoAgente) {
      return res.status(400).json({ error: "tipoAgente é obrigatório" });
    }

    const promptTable = await CreateTemplatePromptService({
      tipoAgente,
      companyId,
      model,
      provider,
      queueId,
      maxMessages,
      maxTokens,
      temperature,
      variables,
      canSendInternalMessages,
      canTransferToAgent,
      canChangeTag,
      permitirCriarAgendamentos,
      businessHours
    });

    const io = getIO();
    io.to(`company-${companyId}-mainchannel`).emit("prompt", {
      action: "update",
      prompt: promptTable
    });

    return res.status(200).json(promptTable);
  } catch (err: any) {
    console.error("Erro ao criar prompt template:", err);
    return res.status(err.statusCode || 500).json({
      error: err.message || "Erro ao criar prompt template"
    });
  }
};
