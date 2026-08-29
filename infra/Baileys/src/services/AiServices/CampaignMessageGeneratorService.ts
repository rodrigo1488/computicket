import AppError from "../../errors/AppError";
import { AIProviderSelector } from "./AIProviderSelector";

interface GenerateInitialMessageParams {
  companyId: number;
  objective: string;
}

interface GenerateVariationsParams {
  companyId: number;
  originalMessage: string;
  objective: string;
}

interface MessageResponse {
  message: string;
}

interface VariationsResponse {
  variations: string[];
}

/**
 * Gera mensagem inicial de campanha baseada no objetivo
 * Usa temperature alta (0.85) para máxima criatividade
 */
export const generateInitialMessage = async ({
  companyId,
  objective
}: GenerateInitialMessageParams): Promise<MessageResponse> => {
  // Selecionar provider usando configuração automática
  const provider = await AIProviderSelector.getProvider(companyId, "campaigns");

  const systemPrompt = `Você é um especialista em marketing e copywriting criativo para WhatsApp Business.

Seu objetivo é criar mensagens de campanha ALTAMENTE PERSUASIVAS e CRIATIVAS para WhatsApp.

CARACTERÍSTICAS IMPORTANTES:
- Seja CRIATIVO e INOVADOR
- Use emojis estrategicamente para impacto visual 📱✨
- Crie senso de urgência quando apropriado ⏰
- Inclua call-to-action claro e direto
- Tom conversacional e amigável
- Linguagem adequada ao objetivo
- Suporte variáveis: {nome}, {empresa}, etc.
- Máximo 600 caracteres (limite WhatsApp)

OBJETIVO DA CAMPANHA:
${objective}

Crie UMA mensagem persuasiva e impactante que atinja esse objetivo.
Retorne APENAS a mensagem, sem explicações adicionais.`;

  try {
    console.log(`🎨 Gerando mensagem inicial de campanha usando ${provider.name}...`);
    console.log(`📝 Objetivo: ${objective}`);

    // Usar o provider selecionado para gerar a mensagem
    const text = await provider.generateText(systemPrompt, {
      temperature: 0.85, // Alta criatividade
      maxTokens: 2048,
      topP: 0.95
    });

    if (!text || text.trim() === "") {
      throw new AppError("Resposta vazia. Tente simplificar o objetivo da campanha.", 500);
    }

    console.log(`✅ Mensagem inicial gerada usando ${provider.name} (${text.length} caracteres)`);

    return {
      message: text.trim()
    };
  } catch (err: any) {
    console.error(`❌ Erro ao gerar mensagem inicial com ${provider.name}:`, {
      message: err.message
    });
    
    if (err instanceof AppError) {
      throw err;
    }
    
    throw new AppError(`Erro ao gerar mensagem: ${err.message || "Erro desconhecido"}`, 500);
  }
};

/**
 * Gera 4 variações criativas da mensagem original
 * Mantém a essência mas varia abordagem e estilo
 */
export const generateVariations = async ({
  companyId,
  originalMessage,
  objective
}: GenerateVariationsParams): Promise<VariationsResponse> => {
  // Selecionar provider usando configuração automática
  const provider = await AIProviderSelector.getProvider(companyId, "campaigns");

  const systemPrompt = `Você é um especialista em marketing e copywriting criativo para WhatsApp Business.

Sua tarefa é criar 4 VARIAÇÕES CRIATIVAS E DISTINTAS da mensagem abaixo, mantendo o mesmo objetivo.

MENSAGEM ORIGINAL:
"${originalMessage}"

OBJETIVO DA CAMPANHA:
${objective}

REGRAS PARA AS VARIAÇÕES:
1. Mantenha a ESSÊNCIA e o OBJETIVO da mensagem original
2. Varie a ESTRUTURA, ABORDAGEM e ESTILO em cada variação
3. Use diferentes ângulos persuasivos (urgência, benefício, exclusividade, etc.)
4. Seja CRIATIVO - evite repetições óbvias
5. Mantenha emojis estratégicos mas varie quais usar
6. Cada variação deve ter tom e personalidade únicos
7. Máximo 600 caracteres por variação
8. Preserve variáveis como {nome}, {empresa} se houver

FORMATO DE RESPOSTA:
Retorne APENAS as 4 variações separadas por "---" (três hífens em linha separada).
Não inclua numeração, explicações ou qualquer outro texto.

Exemplo de formato:
[Variação 1 aqui]
---
[Variação 2 aqui]
---
[Variação 3 aqui]
---
[Variação 4 aqui]`;

  try {
    console.log(`🎨 Gerando 4 variações criativas usando ${provider.name}...`);
    console.log(`📝 Mensagem original: ${originalMessage.substring(0, 50)}...`);

    // Usar o provider selecionado para gerar variações
    const text = await provider.generateText(systemPrompt, {
      temperature: 0.9, // Máxima criatividade para variações
      maxTokens: 4096, // Maior para acomodar 4 variações
      topP: 0.95
    });

    if (!text || text.trim() === "") {
      throw new AppError("Resposta vazia ao gerar variações.", 500);
    }

    // Separar as variações pelo delimitador "---"
    const variations = text
      .split("---")
      .map(v => v.trim())
      .filter(v => v.length > 0);

    if (variations.length < 4) {
      console.warn(`⚠️ Apenas ${variations.length} variações geradas, esperadas 4`);
      
      // Se não gerou 4, completar com a original modificada
      while (variations.length < 4) {
        variations.push(originalMessage + ` [Variação ${variations.length + 1}]`);
      }
    }

    // Garantir apenas 4 variações
    const finalVariations = variations.slice(0, 4);

    console.log(`✅ ${finalVariations.length} variações geradas com sucesso usando ${provider.name}`);

    return {
      variations: finalVariations
    };
  } catch (err: any) {
    console.error(`❌ Erro ao gerar variações com ${provider.name}:`, {
      message: err.message
    });
    
    if (err instanceof AppError) {
      throw err;
    }
    
    throw new AppError(`Erro ao gerar variações: ${err.message || "Erro desconhecido"}`, 500);
  }
};

export default {
  generateInitialMessage,
  generateVariations
};

