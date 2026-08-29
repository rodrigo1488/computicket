import LanchonetesStatsService from "./LanchonetesStatsService";
import {
  isIdentifiedEntregadorName,
  paymentMethodLabel,
} from "../../helpers/paymentMethodUtils";

type Params = {
  companyId: number;
  initialDate?: string;
  finalDate?: string;
  type: "pagamento" | "entregador";
};

const escapeCsv = (value: unknown): string => {
  const text = String(value ?? "");
  if (/[",;\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const LanchonetesReportExportService = async ({
  companyId,
  initialDate,
  finalDate,
  type,
}: Params): Promise<{ filename: string; csv: string }> => {
  const stats = await LanchonetesStatsService(companyId, { initialDate, finalDate });
  const period =
    initialDate && finalDate ? `${initialDate}_a_${finalDate}` : "periodo_atual";

  if (type === "pagamento") {
    const rows = (stats.faturamentoPorMeioPagamento || []).map((row) => ({
      metodo: paymentMethodLabel(row.metodo),
      quantidade: row.quantidade,
      total: row.total,
    }));
    const header = "Meio de pagamento;Quantidade;Total (R$)";
    const body = rows
      .map((r) =>
        [escapeCsv(r.metodo), escapeCsv(r.quantidade), escapeCsv(r.total.toFixed(2))].join(";")
      )
      .join("\n");
    return {
      filename: `faturamento-por-pagamento-${period}.csv`,
      csv: `\uFEFF${header}\n${body}\n`,
    };
  }

  const rows = (stats.entregasPorEntregador || []).filter((row) =>
    isIdentifiedEntregadorName(row.nome)
  );
  const header = "Entregador;Quantidade de entregas";
  const body = rows
    .map((r) => [escapeCsv(r.nome), escapeCsv(r.quantidade)].join(";"))
    .join("\n");
  return {
    filename: `entregas-por-entregador-${period}.csv`,
    csv: `\uFEFF${header}\n${body}\n`,
  };
};

export default LanchonetesReportExportService;
