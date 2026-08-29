import { Request, Response } from "express";
import * as Yup from "yup";
import AppError from "../errors/AppError";
import BuildReciboPdfService from "../services/ReciboServices/BuildReciboPdfService";

export const postPdf = async (req: Request, res: Response): Promise<Response> => {
  const schema = Yup.object().shape({
    variant: Yup.string().oneOf(["full", "reduced"]).required(),
    data: Yup.object().required()
  });

  try {
    await schema.validate(req.body);
  } catch (err: any) {
    throw new AppError(err.message || "Dados inválidos", 400);
  }

  const { variant, data } = req.body as { variant: "full" | "reduced"; data: Record<string, unknown> };

  try {
    const pdf = await BuildReciboPdfService({ variant, data: data as any });
    const filename =
      data?.mesa && (data.mesa as any).number
        ? `conta-mesa-${String((data.mesa as any).number).replace(/\W/g, "_")}.pdf`
        : `recibo-${Date.now()}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(pdf);
  } catch (err: any) {
    console.error("BuildReciboPdfService:", err);
    throw new AppError(err?.message || "Erro ao gerar PDF do recibo", 500);
  }
};
