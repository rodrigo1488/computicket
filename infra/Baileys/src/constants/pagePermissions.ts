export type PageAccessConfig = {
  granted: string[];
  denied: string[];
};

export type PageModuleRequirement = "lanchonetes" | "agendamento";

export type PageDefinition = {
  key: string;
  group: "atendimento" | "gestao" | "automacao" | "administracao" | "sistema" | "operacional";
  /** Maior especificidade primeiro no match de rotas */
  pathPrefix: string;
  superOnly?: boolean;
  /** Exige módulo ativo na empresa para exibir / acessar */
  requiredModule?: PageModuleRequirement;
};

export const PAGE_DEFINITIONS: PageDefinition[] = [
  { key: "tickets-finalizadas", group: "atendimento", pathPrefix: "/tickets/finalizadas" },
  { key: "tickets", group: "atendimento", pathPrefix: "/tickets" },
  { key: "dashboard", group: "atendimento", pathPrefix: "/dashboard" },
  { key: "kanban", group: "atendimento", pathPrefix: "/kanban" },
  { key: "chats", group: "atendimento", pathPrefix: "/chats" },
  { key: "quick-messages", group: "atendimento", pathPrefix: "/quick-messages" },
  { key: "todolist", group: "gestao", pathPrefix: "/todolist" },
  { key: "schedules", group: "gestao", pathPrefix: "/schedules" },
  { key: "contacts", group: "gestao", pathPrefix: "/contacts" },
  { key: "tags", group: "gestao", pathPrefix: "/tags" },
  { key: "forms", group: "gestao", pathPrefix: "/forms" },
  { key: "products", group: "gestao", pathPrefix: "/products", requiredModule: "lanchonetes" },
  { key: "lanchonetes", group: "gestao", pathPrefix: "/lanchonetes", requiredModule: "lanchonetes" },
  { key: "agendamento", group: "gestao", pathPrefix: "/agendamento", requiredModule: "agendamento" },
  { key: "pdv", group: "gestao", pathPrefix: "/pdv", requiredModule: "lanchonetes" },
  { key: "pedidos", group: "gestao", pathPrefix: "/pedidos", requiredModule: "lanchonetes" },
  { key: "mesas", group: "gestao", pathPrefix: "/mesas", requiredModule: "lanchonetes" },
  { key: "campaigns", group: "automacao", pathPrefix: "/campaigns" },
  { key: "contact-lists", group: "automacao", pathPrefix: "/contact-lists" },
  { key: "flowbuilders", group: "automacao", pathPrefix: "/flowbuilders" },
  { key: "flowbuilder", group: "automacao", pathPrefix: "/flowbuilder" },
  { key: "phrase-lists", group: "automacao", pathPrefix: "/phrase-lists" },
  { key: "campaigns-config", group: "automacao", pathPrefix: "/campaigns-config" },
  { key: "prompts", group: "automacao", pathPrefix: "/prompts" },
  { key: "users", group: "administracao", pathPrefix: "/users" },
  { key: "connections", group: "administracao", pathPrefix: "/connections" },
  { key: "queues", group: "administracao", pathPrefix: "/queues" },
  { key: "files", group: "administracao", pathPrefix: "/files" },
  { key: "queue-integration", group: "administracao", pathPrefix: "/queue-integration" },
  { key: "messages-api", group: "administracao", pathPrefix: "/messages-api" },
  { key: "financeiro", group: "administracao", pathPrefix: "/financeiro" },
  { key: "announcements", group: "administracao", pathPrefix: "/announcements", superOnly: true },
  { key: "helps", group: "sistema", pathPrefix: "/helps" },
  { key: "help-articles", group: "sistema", pathPrefix: "/help-articles" },
  { key: "settings", group: "sistema", pathPrefix: "/settings" },
  { key: "quick-access-buttons-settings", group: "sistema", pathPrefix: "/quick-access-buttons-settings" },
  { key: "subscription", group: "sistema", pathPrefix: "/subscription" },
  { key: "garcom", group: "operacional", pathPrefix: "/garcom", requiredModule: "lanchonetes" },
  { key: "cozinha", group: "operacional", pathPrefix: "/cozinha", requiredModule: "lanchonetes" },
  { key: "entregador", group: "operacional", pathPrefix: "/entregador", requiredModule: "lanchonetes" }
];

export const ALL_PAGE_KEYS = PAGE_DEFINITIONS.map(p => p.key);

/** Páginas padrão do perfil user (sem módulos opcionais). */
export const BASE_DEFAULT_USER_PAGE_KEYS: string[] = [
  "tickets",
  "tickets-finalizadas",
  "kanban",
  "chats",
  "quick-messages",
  "todolist",
  "schedules",
  "contacts",
  "tags",
  "forms",
  "campaigns",
  "contact-lists",
  "flowbuilders",
  "flowbuilder",
  "phrase-lists",
  "campaigns-config",
  "prompts",
  "helps",
  "help-articles"
];

export const LANCHONETE_DEFAULT_USER_PAGE_KEYS: string[] = [
  "products",
  "lanchonetes",
  "pdv",
  "pedidos",
  "mesas",
  "garcom",
  "cozinha",
  "entregador"
];

export const AGENDAMENTO_DEFAULT_USER_PAGE_KEYS: string[] = ["agendamento"];

/** Retrocompat: conjunto completo (todos os módulos). */
export const DEFAULT_USER_PAGE_KEYS: string[] = [
  ...BASE_DEFAULT_USER_PAGE_KEYS,
  ...LANCHONETE_DEFAULT_USER_PAGE_KEYS,
  ...AGENDAMENTO_DEFAULT_USER_PAGE_KEYS
];

export const ADMIN_PAGE_KEYS: string[] = PAGE_DEFINITIONS.filter(
  p => p.group === "administracao"
).map(p => p.key);

const PAGE_KEY_SET = new Set(ALL_PAGE_KEYS);

export const isValidPageKey = (key: string): boolean => PAGE_KEY_SET.has(key);

export const sanitizePageAccess = (
  input: unknown
): PageAccessConfig | null => {
  if (!input || typeof input !== "object") {
    return null;
  }

  const raw = input as { granted?: unknown; denied?: unknown };
  const granted = Array.isArray(raw.granted)
    ? raw.granted.filter((k): k is string => typeof k === "string" && isValidPageKey(k))
    : [];
  const denied = Array.isArray(raw.denied)
    ? raw.denied.filter((k): k is string => typeof k === "string" && isValidPageKey(k))
    : [];

  if (granted.length === 0 && denied.length === 0) {
    return null;
  }

  return { granted, denied };
};
