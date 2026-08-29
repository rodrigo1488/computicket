/**
 * Valida dados da empresa antes de criar cliente no Asaas (evita "celular inválido" etc.).
 * Asaas espera celular BR com DDD — 10 ou 11 dígitos; opcional omitir se inválido.
 */

export type AsaasCompanyFieldIssue = {
  field: "name" | "email" | "phone";
  message: string;
};

export type AsaasCompanyDataCheck = {
  valid: boolean;
  issues: AsaasCompanyFieldIssue[];
  /** Valores atuais para pré-preencher o modal */
  company: {
    name: string;
    email: string;
    phone: string;
  };
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

/**
 * Telefone aceito pelo Asaas como mobilePhone: 10 ou 11 dígitos (BR).
 * 11 = DDD + 9 + 8 dígitos (celular). 10 = DDD + 8 dígitos (fixo — alguns gateways aceitam).
 */
export function isValidBrazilPhoneForAsaas(phone: string): boolean {
  const d = onlyDigits(phone);
  return d.length === 10 || d.length === 11;
}

/**
 * Retorna mobilePhone só se válido; senão undefined (não enviar ao Asaas).
 */
export function sanitizeMobilePhoneForAsaas(phone: string): string | undefined {
  const d = onlyDigits(phone);
  if (d.length === 10 || d.length === 11) return d;
  return undefined;
}

export function validateCompanyForAsaasCustomer(company: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}): AsaasCompanyDataCheck {
  const name = (company.name || "").trim();
  const email = (company.email || "").trim();
  const phone = company.phone || "";
  const issues: AsaasCompanyFieldIssue[] = [];

  if (!name || name.length < 2) {
    issues.push({
      field: "name",
      message: "Nome da empresa é obrigatório (mínimo 2 caracteres).",
    });
  }

  if (!email) {
    issues.push({
      field: "email",
      message: "E-mail é obrigatório para cadastro no Asaas.",
    });
  } else if (!EMAIL_REGEX.test(email)) {
    issues.push({
      field: "email",
      message: "E-mail inválido.",
    });
  }

  if (!onlyDigits(phone)) {
    issues.push({
      field: "phone",
      message:
        "Celular/telefone é obrigatório. Informe DDD + número (10 ou 11 dígitos), somente números.",
    });
  } else if (!isValidBrazilPhoneForAsaas(phone)) {
    issues.push({
      field: "phone",
      message:
        "Celular inválido. Use DDD + número: 11 dígitos para celular (ex.: 11999998888) ou 10 para fixo.",
    });
  }

  return {
    valid: issues.length === 0,
    issues,
    company: { name, email, phone },
  };
}
