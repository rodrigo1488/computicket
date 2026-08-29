import { Request, Response } from "express";
import { createJob, getJob, AiJobType } from "../services/AiServices/AiJobQueueService";

const VALID_TYPES: AiJobType[] = [
  "campaign_initial",
  "campaign_variations",
  "agent_summary",
  "general_summary",
  "improve_message",
  "analyze_chat",
  "dashboard_command",
];

export const startJob = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const { type, payload } = req.body;

  if (!type || !VALID_TYPES.includes(type)) {
    return res.status(400).json({
      error: "JOB_TYPE_INVALID",
      message: `Tipo de job inválido. Use um de: ${VALID_TYPES.join(", ")}`,
    });
  }

  if (!payload || typeof payload !== "object") {
    return res.status(400).json({
      error: "PAYLOAD_REQUIRED",
      message: "payload é obrigatório e deve ser um objecto JSON",
    });
  }

  const enrichedPayload = {
    ...payload,
    companyId,
    userId: Number(userId),
  };

  const jobId = createJob(type as AiJobType, enrichedPayload);
  return res.status(202).json({ jobId });
};

export const getJobStatus = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { jobId } = req.params;

  if (!jobId) {
    return res.status(400).json({ error: "jobId é obrigatório" });
  }

  const job = getJob(jobId);

  if (!job) {
    return res.status(404).json({
      error: "JOB_NOT_FOUND",
      message: "Job não encontrado ou já expirou (máx. 10 min).",
    });
  }

  return res.status(200).json(job);
};
