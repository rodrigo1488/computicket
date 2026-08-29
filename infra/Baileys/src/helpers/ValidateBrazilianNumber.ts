/**
 * Valida se um número é brasileiro (código de país +55)
 * @param number - Número do WhatsApp com ou sem formatação
 * @returns true se o número é brasileiro, false caso contrário
 */
export const isBrazilianNumber = (number: string): boolean => {
  // Remove todos os caracteres não numéricos
  const cleanNumber = number.replace(/\D/g, "");
  
  // Validação 1: Número não pode estar vazio
  if (!cleanNumber || cleanNumber.length === 0) {
    return false;
  }
  
  // Validação 2: Números muito longos sem código de país são inválidos
  // Exemplo: 148679084212438 (15 dígitos sem código de país)
  // Números válidos brasileiros têm no máximo 13 dígitos (55 + DDD + número)
  if (cleanNumber.length > 13) {
    return false;
  }
  
  // Validação 3: Número brasileiro deve ter pelo menos 12 dígitos (55 + DDD + número)
  // 12 dígitos: 55 + DDD (2) + telefone fixo (8)
  // 13 dígitos: 55 + DDD (2) + celular (9)
  if (cleanNumber.length < 12) {
    return false;
  }
  
  // Validação 4: DEVE começar com 55 (código do Brasil)
  // Rejeita qualquer número que não comece com 55
  if (!cleanNumber.startsWith("55")) {
    return false;
  }
  
  // Validação 5: Após o código 55, deve ter DDD válido do Brasil
  const ddd = cleanNumber.substring(2, 4);
  const dddNumber = parseInt(ddd, 10);
  
  // DDDs válidos no Brasil (lista completa)
  const validDDDs = [
    11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
    21, 22, 24, 27, 28, // RJ/ES
    31, 32, 33, 34, 35, 37, 38, // MG
    41, 42, 43, 44, 45, 46, // PR
    47, 48, 49, // SC
    51, 53, 54, 55, // RS
    61, // DF
    62, 64, // GO
    63, // TO
    65, 66, // MT
    67, // MS
    68, // AC
    69, // RO
    71, 73, 74, 75, 77, // BA
    79, // SE
    81, 87, // PE
    82, // AL
    83, // PB
    84, // RN
    85, 88, // CE
    86, 89, // PI
    91, 93, 94, // PA
    92, 97, // AM
    95, // RR
    96, // AP
    98, 99 // MA
  ];
  
  if (isNaN(dddNumber) || !validDDDs.includes(dddNumber)) {
    return false;
  }
  
  // Validação 6: Verifica se o número completo tem formato válido
  // Após 55 + DDD (4 dígitos), deve ter 8 ou 9 dígitos
  const phoneNumber = cleanNumber.substring(4);
  if (phoneNumber.length < 8 || phoneNumber.length > 9) {
    return false;
  }
  
  return true;
};

/**
 * Extrai o código do país de um número
 * @param number - Número do WhatsApp
 * @returns Código do país (ex: "55", "1", "44") ou string vazia se não detectar
 */
export const getCountryCode = (number: string): string => {
  const cleanNumber = number.replace(/\D/g, "");
  
  // Se o número é muito longo sem código de país detectável, retorna vazio
  // Números normais têm no máximo 15 dígitos com código de país
  if (cleanNumber.length > 15) {
    return "";
  }
  
  // Códigos de país mais comuns têm 1-3 dígitos
  // Brasil: 55, EUA: 1, Reino Unido: 44, etc.
  if (cleanNumber.length >= 2) {
    const twoDigits = cleanNumber.substring(0, 2);
    // Lista de códigos de 2 dígitos válidos
    const twoDigitCodes = ["55", "44", "49", "33", "34", "39", "41", "43", "45", "46", "47", "48", "51", "52", "53", "54", "56", "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98"];
    
    if (twoDigitCodes.includes(twoDigits)) {
      return twoDigits;
    }
  }
  
  if (cleanNumber.length >= 1) {
    // Código de 1 dígito (EUA/Canadá: 1)
    const oneDigit = cleanNumber.substring(0, 1);
    if (oneDigit === "1") {
      return oneDigit;
    }
  }
  
  // Se não detectou código de país válido, retorna vazio
  return "";
};

/**
 * Formata mensagem de log com informações do número bloqueado
 * @param number - Número bloqueado
 * @param countryCode - Código do país (pode ser vazio)
 * @returns Mensagem formatada para log
 */
export const formatBlockedNumberLog = (number: string, countryCode: string): string => {
  if (countryCode) {
    return `Mensagem bloqueada: número não-brasileiro (+${countryCode}) - ${number}`;
  } else {
    // Número sem código de país detectável (número estranho)
    return `Mensagem bloqueada: número inválido sem código de país - ${number} (${number.length} dígitos)`;
  }
};

