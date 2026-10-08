import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  Cog,
  Columns3,
  FileSignature,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Headset,
  KeyRound,
  Layers,
  LifeBuoy,
  Lock,
  MapPin,
  MessageCircle,
  Monitor,
  PieChart,
  Settings,
  ShoppingCart,
  Ticket,
  UserCog,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";
import { parseHref, toHref } from "./tabs-store";

type PageModule = { default: ComponentType };

export type RouteParams = Record<string, string>;

export type RouteDef = {
  /** Padrão com segmentos dinâmicos `:nome` (ex.: `/tickets/:id`). */
  pattern: string;
  title: string | ((params: RouteParams) => string);
  icon: LucideIcon;
  /**
   * Carrega o componente da página. Sem `load` a rota é "nativa": o Next renderiza a página
   * normalmente (sem preservar estado).
   */
  load?: () => Promise<PageModule>;
  /**
   * `true` (padrão): a página fica montada (oculta) enquanto a aba está inativa e o estado
   * local sobrevive. `false`: desmonta ao sair da aba (só a URL/query é preservada) — usado em
   * telas de tempo real (sockets/"marcar como lido") em que manter montado teria efeito colateral.
   */
  keepAlive?: boolean;
  /** `chat`: moldura sem padding, altura total (Help Desk, Chat, editor de fluxo). */
  layout?: "page" | "chat";
  /** O estado da tela vive na query (`?tab=`, `?c=`): link com query reaproveita a aba. */
  reuseSearch?: boolean;
};

const id = (label: string) => (p: RouteParams) => `${label} #${decodeURIComponent(p.id ?? "")}`;

export const ROUTES: RouteDef[] = [
  {
    pattern: "/dashboard",
    title: "Dashboard",
    icon: BarChart3,
    load: () => import("@/app/(app)/dashboard/page"),
    reuseSearch: true,
  },
  {
    pattern: "/helpdesk",
    title: "Help Desk",
    icon: Headset,
    load: () => import("@/app/(app)/helpdesk/page"),
    keepAlive: false,
    layout: "chat",
    reuseSearch: true,
  },
  {
    pattern: "/contatos-suporte",
    title: "Contatos de suporte",
    icon: LifeBuoy,
    load: () => import("@/app/(app)/contatos-suporte/page"),
    keepAlive: false,
    layout: "chat",
    reuseSearch: true,
  },
  {
    pattern: "/chat",
    title: "Chat",
    icon: MessageCircle,
    load: () => import("@/app/(app)/chat/page"),
    keepAlive: false,
    layout: "chat",
    reuseSearch: true,
  },
  { pattern: "/tickets", title: "Tickets", icon: Ticket, load: () => import("@/app/(app)/tickets/page") },
  { pattern: "/tickets/novo", title: "Novo ticket", icon: Ticket, load: () => import("@/app/(app)/tickets/novo/page") },
  {
    pattern: "/tickets/:id/editar",
    title: (p) => `Editar ticket #${p.id ?? ""}`,
    icon: Ticket,
    load: () => import("@/app/(app)/tickets/[id]/editar/page"),
  },
  {
    pattern: "/tickets/:id",
    title: id("Ticket"),
    icon: Ticket,
    load: () => import("@/app/(app)/tickets/[id]/page"),
  },
  { pattern: "/agenda", title: "Agenda", icon: CalendarDays, load: () => import("@/app/(app)/agenda/page") },
  {
    pattern: "/ordens-servico",
    title: "Ordens de Serviço",
    icon: ClipboardList,
    load: () => import("@/app/(app)/ordens-servico/page"),
  },
  { pattern: "/clientes", title: "Clientes", icon: Users, load: () => import("@/app/(app)/clientes/page") },
  { pattern: "/servicos", title: "Serviços", icon: Cog, load: () => import("@/app/(app)/servicos/page") },
  { pattern: "/contratos", title: "Contratos", icon: FileSignature, load: () => import("@/app/(app)/contratos/page") },
  {
    pattern: "/contratos/:contractName",
    title: (p) => {
      try {
        return decodeURIComponent(p.contractName ?? "Contrato");
      } catch {
        return p.contractName ?? "Contrato";
      }
    },
    icon: FileSignature,
    load: () => import("@/app/(app)/contratos/[contractName]/page"),
  },
  { pattern: "/planos", title: "Planos", icon: Layers, load: () => import("@/app/(app)/planos/page") },
  {
    pattern: "/implantacao",
    title: "Implantação",
    icon: Columns3,
    load: () => import("@/app/(app)/implantacao/page"),
    reuseSearch: true,
  },
  {
    pattern: "/implantacao/modelos",
    title: "Modelos de implantação",
    icon: Columns3,
    load: () => import("@/app/(app)/implantacao/modelos/page"),
  },
  {
    pattern: "/monitoramento",
    title: "Monitoramento",
    icon: MapPin,
    load: () => import("@/app/(app)/monitoramento/page"),
    keepAlive: false,
  },
  {
    pattern: "/monitoramento-remoto",
    title: "Monitoramento remoto",
    icon: Monitor,
    load: () => import("@/app/(app)/monitoramento-remoto/page"),
    keepAlive: false,
  },
  {
    pattern: "/monitoramento-remoto/:id",
    title: id("Máquina"),
    icon: Monitor,
    load: () => import("@/app/(app)/monitoramento-remoto/[id]/page"),
    keepAlive: false,
  },
  { pattern: "/relatorios", title: "Relatórios", icon: PieChart, load: () => import("@/app/(app)/relatorios/page") },
  { pattern: "/ps", title: "PS", icon: FileText, load: () => import("@/app/(app)/ps/page") },
  {
    pattern: "/venda-avulsa",
    title: "Venda Avulsa",
    icon: ShoppingCart,
    load: () => import("@/app/(app)/venda-avulsa/page"),
  },
  { pattern: "/cofre", title: "Cofre de Senhas", icon: Lock, load: () => import("@/app/(app)/cofre/page") },
  {
    pattern: "/cofre/:clientId",
    title: (p) => `Cofre #${p.clientId ?? ""}`,
    icon: KeyRound,
    load: () => import("@/app/(app)/cofre/[clientId]/page"),
    reuseSearch: true,
  },
  {
    pattern: "/conhecimento",
    title: "Conhecimento",
    icon: GraduationCap,
    load: () => import("@/app/(app)/conhecimento/page"),
  },
  {
    pattern: "/conhecimento/:categoryId",
    title: (p) => `Categoria #${p.categoryId ?? ""}`,
    icon: GraduationCap,
    load: () => import("@/app/(app)/conhecimento/[categoryId]/page"),
    reuseSearch: true,
  },
  {
    pattern: "/utilitarios/gerenciar",
    title: "Utilitários",
    icon: Wrench,
    load: () => import("@/app/(app)/utilitarios/gerenciar/page"),
  },
  { pattern: "/inventario", title: "Inventário", icon: Boxes, load: () => import("@/app/(app)/inventario/page") },
  {
    pattern: "/orcamentos",
    title: "Orçamentos",
    icon: FileSpreadsheet,
    load: () => import("@/app/(app)/orcamentos/page"),
  },
  {
    pattern: "/orcamentos/novo",
    title: "Novo orçamento",
    icon: FileSpreadsheet,
    load: () => import("@/app/(app)/orcamentos/novo/page"),
  },
  {
    pattern: "/orcamentos/:id/editar",
    title: (p) => `Editar orçamento #${p.id ?? ""}`,
    icon: FileSpreadsheet,
    load: () => import("@/app/(app)/orcamentos/[id]/editar/page"),
  },
  {
    pattern: "/orcamentos/:id",
    title: id("Orçamento"),
    icon: FileSpreadsheet,
    load: () => import("@/app/(app)/orcamentos/[id]/page"),
  },
  { pattern: "/usuarios", title: "Usuários", icon: UserCog, load: () => import("@/app/(app)/usuarios/page") },
  {
    pattern: "/configuracoes",
    title: "Configurações",
    icon: Settings,
    load: () => import("@/app/(app)/configuracoes/page"),
    reuseSearch: true,
  },
  {
    pattern: "/automacao/:id",
    title: id("Fluxo"),
    icon: Workflow,
    load: () => import("@/app/(app)/automacao/[id]/page"),
    layout: "chat",
  },
];

/** Páginas de redirecionamento do servidor (não podem ser renderizadas como aba). */
const REDIRECTS: Record<string, string> = {
  "/vendas": "/venda-avulsa",
  "/automacao": "/configuracoes?tab=whatsapp&section=automacao",
};

/** Resolve redirecionamentos conhecidos antes de abrir/ativar uma aba. */
export function resolveHref(href: string): string {
  const { pathname, search } = parseHref(href);
  const target = REDIRECTS[pathname];
  return target ? target : toHref(pathname, search);
}

type Compiled = { def: RouteDef; segments: string[] };
const COMPILED: Compiled[] = ROUTES.map((def) => ({ def, segments: def.pattern.split("/").filter(Boolean) }));

export type RouteMatch = { def: RouteDef; params: RouteParams };

/** Casa um pathname com a tabela de rotas (a primeira que bater vence). */
export function matchRoute(pathname: string): RouteMatch | null {
  const parts = pathname.split("/").filter(Boolean);
  for (const { def, segments } of COMPILED) {
    if (segments.length !== parts.length) continue;
    const params: RouteParams = {};
    let ok = true;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg.startsWith(":")) params[seg.slice(1)] = parts[i];
      else if (seg !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { def, params };
  }
  return null;
}

export function routeTitle(pathname: string): string {
  const match = matchRoute(pathname);
  if (match) return typeof match.def.title === "function" ? match.def.title(match.params) : match.def.title;
  const last = pathname.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last).replace(/-/g, " ") : "Início";
}

export function reuseSearchFor(pathname: string): boolean {
  return matchRoute(pathname)?.def.reuseSearch === true;
}

export function isChatLayoutPath(pathname: string): boolean {
  const match = matchRoute(pathname);
  if (match) return match.def.layout === "chat";
  return pathname.startsWith("/helpdesk") || pathname.startsWith("/chat") || pathname.startsWith("/contatos-suporte");
}

const lazyCache = new Map<string, LazyExoticComponent<ComponentType>>();

/** Componente `React.lazy` estável por rota. */
export function getRouteComponent(def: RouteDef): LazyExoticComponent<ComponentType> | null {
  if (!def.load) return null;
  let cached = lazyCache.get(def.pattern);
  if (!cached) {
    cached = lazy(def.load);
    lazyCache.set(def.pattern, cached);
  }
  return cached;
}

export function routeIcon(pathname: string): LucideIcon {
  return matchRoute(pathname)?.def.icon ?? FileText;
}
