/**
 * Valida se um número é um telefone válido (para uso em sender/contato).
 * Verifica comprimento (10–15 dígitos) e código de país conhecido para evitar
 * salvar IDs de sessão, LIDs (numero@lid) ou IDs de grupo como número de telefone.
 *
 * @param number - Número a ser validado (pode conter caracteres não numéricos)
 * @returns true se o número é válido, false caso contrário
 */
export const KNOWN_COUNTRY_CODES = [
  "1", "44", "49", "52", "55", "56", "54", "351", "34", "39", "33", "41", "43",
  "45", "46", "47", "48", "51", "53", "57", "58", "60", "61", "62", "63", "64",
  "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98"
];

export function isValidPhoneNumber(number: string): boolean {
  const cleanNumber = number.replace(/\D/g, "");

  if (cleanNumber.length < 10 || cleanNumber.length > 15) {
    return false;
  }

  const hasValidCountryCode = KNOWN_COUNTRY_CODES.some(code =>
    cleanNumber.startsWith(code)
  );

  return hasValidCountryCode;
}
