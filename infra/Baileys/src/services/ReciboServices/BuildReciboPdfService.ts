import puppeteer from "puppeteer";
import { aggregateReciboMenuItems, menuItemLineTotal, ReciboMenuItem } from "./aggregateReciboMenuItems";

export interface ReciboPdfData {
  pedidos?: Array<{
    id?: number;
    protocol?: string;
    submittedAt?: string | Date;
    total?: number;
    menuItems?: ReciboMenuItem[];
  }>;
  total?: number;
  subtotal?: number;
  desconto?: number;
  mesa?: { number?: string; name?: string; type?: string } | null;
  cliente?: { name?: string; number?: string } | null;
  meiosPagamento?: Array<{ metodo?: string; valor?: number }>;
}

export interface ReciboPdfRequest {
  variant: "full" | "reduced";
  data: ReciboPdfData;
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(n: number): string {
  return `R$ ${Number(n || 0).toFixed(2).replace(".", ",")}`;
}

function buildHtml({ variant, data }: ReciboPdfRequest): string {
  const isVendaDireta = !data.mesa;
  const tipoConta = isVendaDireta ? "VENDA PDV" : data.mesa?.type === "comanda" ? "COMANDA" : "MESA";
  const numeroConta = isVendaDireta ? "" : data.mesa?.number || data.mesa?.name || "";
  const dataHora = new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  const clienteNome = data.cliente?.name || data.cliente?.number || "";
  const tituloModo = variant === "reduced" ? "Recibo (impressão reduzida)" : "Recibo";

  let bodyRows = "";
  if (variant === "reduced") {
    const agg = aggregateReciboMenuItems(data.pedidos || []);
    for (const row of agg) {
      bodyRows += `<tr><td>${escapeHtml(row.productName)}</td><td style="text-align:right">${row.quantity}</td><td style="text-align:right">${formatMoney(row.unitValue)}</td><td style="text-align:right">${formatMoney(row.lineTotal)}</td></tr>`;
    }
  } else {
    for (const pedido of data.pedidos || []) {
      const protocol = pedido.protocol || `#${pedido.id}`;
      const dataPedido = pedido.submittedAt
        ? new Date(pedido.submittedAt).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
          })
        : "";
      bodyRows += `<tr><td colspan="4" style="font-weight:bold;padding-top:12px">${escapeHtml(protocol)} ${escapeHtml(dataPedido)}</td></tr>`;
      for (const item of pedido.menuItems || []) {
        const qty = Number(item.quantity) || 0;
        const name = item.productName || "Item";
        const unit = (Number(item.productValue) || 0) + (Number(item.addonsTotal) || 0);
        const sub = menuItemLineTotal(item);
        bodyRows += `<tr><td>${escapeHtml(name)}</td><td style="text-align:right">${qty}</td><td style="text-align:right">${formatMoney(unit)}</td><td style="text-align:right">${formatMoney(sub)}</td></tr>`;
      }
      bodyRows += `<tr><td colspan="3" style="text-align:right;font-weight:600">Subtotal</td><td style="text-align:right;font-weight:600">${formatMoney(Number(pedido.total) || 0)}</td></tr>`;
    }
  }

  let payBlock = "";
  if (Array.isArray(data.meiosPagamento) && data.meiosPagamento.length > 0) {
    payBlock = "<h3>Pagamento</h3><ul>";
    for (const p of data.meiosPagamento) {
      const metodo = String(p?.metodo || "").toUpperCase() || "OUTRO";
      const val = Number(p?.valor || 0);
      payBlock += `<li>${escapeHtml(metodo)}: ${formatMoney(val)}</li>`;
    }
    payBlock += "</ul>";
  }

  const headerLine = numeroConta ? `${tipoConta}: ${escapeHtml(numeroConta)}` : escapeHtml(tipoConta);

  const descontoVal = Number(data.desconto || 0);
  const subtotalVal = data.subtotal != null ? Number(data.subtotal) : null;
  let totalBlock = "";
  if (descontoVal > 0.001) {
    const sub = subtotalVal != null ? subtotalVal : Number(data.total || 0) + descontoVal;
    totalBlock += `<p class="muted" style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${formatMoney(sub)}</span></p>`;
    totalBlock += `<p class="muted" style="display:flex;justify-content:space-between"><span>Desconto</span><span>- ${formatMoney(descontoVal)}</span></p>`;
  }
  totalBlock += `<p class="total">TOTAL: ${formatMoney(Number(data.total) || 0)}</p>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; font-size: 12px; color: #111; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    h2 { font-size: 14px; margin: 16px 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #ddd; padding: 6px 4px; text-align: left; }
    th { background: #f5f5f5; font-size: 11px; }
    .muted { color: #666; font-size: 11px; }
    .total { font-size: 16px; font-weight: 700; margin-top: 16px; }
    .nf { font-size: 11px; color: #666; margin-top: 24px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(tituloModo)}</h1>
  <p class="muted">Documento sem valor fiscal</p>
  <p>${headerLine}<br/>Data/Hora: ${escapeHtml(dataHora)}${
    !isVendaDireta && clienteNome ? `<br/>Cliente: ${escapeHtml(clienteNome)}` : ""
  }</p>
  <h2>Itens</h2>
  <table>
    <thead><tr><th>Descrição</th><th style="text-align:right">Qtd</th><th style="text-align:right">Unit.</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  ${totalBlock}
  ${payBlock}
  <p class="nf">Obrigado! Volte sempre.</p>
</body>
</html>`;
}

const BuildReciboPdfService = async (req: ReciboPdfRequest): Promise<Buffer> => {
  const html = buildHtml(req);
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 45000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" }
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
};

export default BuildReciboPdfService;
