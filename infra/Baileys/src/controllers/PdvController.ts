import { Request, Response } from "express";
import RegisterGourmetVendaService from "../services/GourmetFinanceiroServices/RegisterGourmetVendaService";
import RelatorioProdutosService from "../services/PdvServices/RelatorioProdutosService";
import AppError from "../errors/AppError";
import moment from "moment";
import {
  applyDiscount,
  calcSubtotalFromPdvItens,
  validatePayments,
  DescontoInput,
} from "../helpers/gourmetOrderTotals";

interface ItemBody {
  productName: string;
  quantity: number;
  productValue: number;
}

export const registrarVenda = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { itens, total, meiosPagamento, desconto } = req.body as {
    itens?: ItemBody[];
    total?: number;
    meiosPagamento?: any;
    desconto?: DescontoInput | null;
  };

  if (!Array.isArray(itens) || itens.length === 0) {
    throw new AppError("ERR_PDV_ITENS_REQUIRED", 400);
  }

  const itensNormalizados = itens.map((i: ItemBody) => ({
    productName: i.productName || "",
    quantity: Number(i.quantity) || 0,
    productValue: Number(i.productValue) ?? 0,
  }));

  const subtotalBruto = calcSubtotalFromPdvItens(itensNormalizados);
  const { subtotal, desconto: descontoEfetivo, total: totalLiquido, descontoTipo, descontoValor } =
    applyDiscount(subtotalBruto, desconto);

  const totalRecebido = Number(total);
  if (isNaN(totalRecebido) || Math.abs(totalRecebido - totalLiquido) > 0.01) {
    throw new AppError("ERR_PDV_TOTAL_MISMATCH", 400);
  }

  if (meiosPagamento != null) {
    const payCheck = validatePayments(totalLiquido, meiosPagamento, { requireFullPayment: true });
    if (!payCheck.ok) {
      throw new AppError("ERR_PDV_PAYMENT_MISMATCH", 400);
    }
  }

  const record = await RegisterGourmetVendaService({
    companyId,
    tipo: "pdv",
    valor: totalLiquido,
    subtotal,
    desconto: descontoEfetivo,
    descontoTipo,
    descontoValor,
    meiosPagamento: meiosPagamento ?? null,
    itens: itensNormalizados,
  });

  return res.status(200).json({
    id: record.id,
    total: Number(record.valor),
    subtotal: Number(record.subtotal ?? subtotal),
    desconto: Number(record.desconto ?? descontoEfetivo),
    itens: itensNormalizados,
    meiosPagamento: (record as any).meiosPagamento ?? meiosPagamento ?? null,
  });
};

export const relatorioProdutos = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const today = moment().format("YYYY-MM-DD");
  const startDate = String(req.query.startDate || today);
  const endDate = String(req.query.endDate || today);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
  ) {
    throw new AppError("ERR_PDV_DATE_INVALID", 400);
  }

  const result = await RelatorioProdutosService({ companyId, startDate, endDate });
  return res.status(200).json(result);
};
