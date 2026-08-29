import AppError from "../../errors/AppError";
import { AIProviderFactory } from "../AiServices/AIProviderFactory";
import {
  createOpenAIClient,
  getLmStudioDefaultModel,
  getChatCompletionAssistantText,
  OPENAI_VISION_MODEL
} from "../../config/openai";

const DESPESA_EXTRACTION_PROMPT = `Analise a imagem (foto/scan) de um documento de despesa (boleto, nota fiscal, recibo, fatura) e extraia as informações.

Responda APENAS com um JSON válido, sem explicação nem markdown, no formato exato:
{
  "descricao": "string curta (ex.: 'Conta de luz', 'Boleto Internet', 'NF Mercado')",
  "fornecedor": "nome do emitente ou credor (ex.: razão social, nome do fornecedor, nome da empresa no cabeçalho). String vazia se não houver legível.",
  "observacoes": "string opcional (pode ser vazia)",
  "valor": 123.45,
  "dataVencimento": "YYYY-MM-DD"
}

Regras:
- "fornecedor": extraia o nome da empresa/emitente que emitiu (boleto, NF, fatura). Se não houver, use "".
- Use ponto para decimais (123.45).
- Se o documento tiver mais de um valor (ex.: total, juros, desconto), use o TOTAL a pagar.
- Se não encontrar data de vencimento, tente data de emissão; se mesmo assim não existir, use a data de hoje.
- Converta datas no formato brasileiro (DD/MM/AAAA) para YYYY-MM-DD.
- Se algum campo não estiver claro, estime a melhor opção sem inventar números absurdos.
`;

export type ExtractedDespesa = {
  descricao: string;
  fornecedor: string;
  observacoes: string;
  valor: number;
  dataVencimento: string; // YYYY-MM-DD
};

function extractJsonFromResponse(raw: string): string {
  let text = raw.trim();
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    text = jsonMatch[1].trim();
  }
  return text;
}

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function parseAndValidate(rawJson: string): ExtractedDespesa {
  const parsed = JSON.parse(rawJson) as any;

  const descricao = typeof parsed.descricao === "string" ? parsed.descricao.trim() : "";
  let fornecedor = typeof parsed.fornecedor === "string" ? parsed.fornecedor.trim() : "";
  if (fornecedor.length > 255) fornecedor = fornecedor.slice(0, 255);
  const observacoes = typeof parsed.observacoes === "string" ? parsed.observacoes.trim() : "";

  let valor = 0;
  if (typeof parsed.valor === "number") valor = parsed.valor;
  else if (typeof parsed.valor === "string") {
    const n = parseFloat(parsed.valor.replace(/\./g, "").replace(",", "."));
    if (!isNaN(n)) valor = n;
  }
  if (!Number.isFinite(valor) || valor < 0) valor = 0;

  let dataVencimento = typeof parsed.dataVencimento === "string" ? parsed.dataVencimento.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataVencimento)) {
    const m = dataVencimento.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) dataVencimento = `${m[3]}-${m[2]}-${m[1]}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataVencimento)) {
    dataVencimento = todayISO();
  }

  return {
    descricao: descricao || "Despesa",
    fornecedor,
    observacoes,
    valor: Math.round(valor * 100) / 100,
    dataVencimento,
  };
}

async function extractWithLmStudioVision(
  fileBase64: string,
  mimeType: string
): Promise<string> {
  const client = createOpenAIClient();
  const dataUrl = `data:${mimeType};base64,${fileBase64}`;
  const visionModel = OPENAI_VISION_MODEL || getLmStudioDefaultModel();

  const completion = await client.createChatCompletion({
    model: visionModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: DESPESA_EXTRACTION_PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ] as any,
      },
    ],
    max_tokens: 1024,
    temperature: 0.2,
  });

  const text = getChatCompletionAssistantText(completion.data);
  if (!text) throw new AppError("Não foi possível extrair a despesa. Tente outra imagem.", 400);
  return text;
}

export default async function ExtractDespesaFromDocumentService(params: {
  companyId: number;
  fileBase64: string;
  mimeType: string;
}): Promise<ExtractedDespesa> {
  const { companyId, fileBase64, mimeType } = params;

  const providers = await AIProviderFactory.getAvailableProviders(companyId);
  if (!providers.openai) {
    throw new AppError(
      "Servidor de IA não configurado. O administrador deve definir LM_STUDIO_BASE_URL no ambiente do backend.",
      400
    );
  }

  const rawResponse = await extractWithLmStudioVision(fileBase64, mimeType);

  const jsonStr = extractJsonFromResponse(rawResponse);
  try {
    return parseAndValidate(jsonStr);
  } catch {
    throw new AppError("Não foi possível extrair os dados da despesa. Tente uma imagem mais nítida.", 400);
  }
}
