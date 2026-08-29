/**
 * Normaliza números brasileiros para envio via WhatsApp (E.164 sem '+').
 *
 * Regras:
 * - Remove não-dígitos
 * - Garante prefixo "55" quando houver DDD+número
 * - 12 dígitos (55+DDD+8): mantém como está (provider espera 12 para disparo)
 * - 13 dígitos (55+DDD+9+8): remove o 5º dígito (9 extra) para 12 dígitos
 * - 14 dígitos com 9 duplicado: remove um 9
 */
export function normalizeBrazilPhoneForWhatsapp(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";

  // Se já tem 55
  if (digits.startsWith("55")) {
    // 55 + DDD(2) + 8 = 12 -> manter como está para disparo (não inserir 9; provider espera 12 dígitos)
    if (digits.length === 12) {
      return digits;
    }
    // 55 + DDD(2) + 9(extra) + 8 = 13 dígitos: remover 5º dígito (índice 4) para formato de disparo
    // Ex.: 5534999999999 -> 553499999999
    if (digits.length === 13 && digits[4] === "9") {
      return digits.slice(0, 4) + digits.slice(5);
    }
    // Possível 9 duplicado (caso raro): 55 + DDD + 10 dígitos = 14
    // Ex.: 55DD99XXXXXXXX (um 9 extra inserido)
    if (digits.length === 14 && digits[4] === "9" && digits[5] === "9") {
      return digits.slice(0, 4) + digits.slice(5);
    }
    return digits;
  }

  // Sem 55: DDD(2)+8 dígitos = 10 -> retornar 55+10 = 12 dígitos (não inserir 9 para disparo)
  if (digits.length === 10) {
    return "55" + digits;
  }
  if (digits.length === 11) {
    // DDD(2) + 9
    return "55" + digits;
  }

  // Outros tamanhos: retorna como está (melhor que quebrar), mas sem caracteres.
  return digits;
}

