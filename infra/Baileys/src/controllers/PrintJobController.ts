import { Request, Response } from "express";
import ReprintPrintJobService from "../services/PrintJobService/ReprintPrintJobService";
import ReprocessUniplusFormResponseService from "../services/UniplusServices/ReprocessUniplusFormResponseService";

export const reprint = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const rawId = req.params.jobId;
  const sourceJobId = Number(rawId);

  const { job, dispatched } = await ReprintPrintJobService({
    companyId,
    sourceJobId
  });

  return res.status(201).json({
    id: job.id,
    status: job.status,
    deviceId: job.deviceId,
    formResponseId: job.formResponseId,
    dispatched,
    message: dispatched
      ? "Reimpressão enviada para o agente de impressão."
      : "Reimpressão registrada e ficará na fila até o agente conectar à impressora."
  });
};

export const reprocessUniplus = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const formResponseId = Number(req.params.formResponseId);

  const result = await ReprocessUniplusFormResponseService({
    companyId,
    formResponseId,
  });

  return res.status(200).json(result);
};
