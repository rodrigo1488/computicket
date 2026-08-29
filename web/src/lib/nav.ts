import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Users,
  Cog,
  FileSignature,
  Layers,
  Headset,
  MapPin,
  PieChart,
  FileText,
  ShoppingCart,
  Lock,
  GraduationCap,
  Boxes,
  FileSpreadsheet,
  UserCog,
  Settings,
  Ticket,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  techOnly?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/ordens-servico", label: "Ordens de Serviço", icon: ClipboardList },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/servicos", label: "Serviços", icon: Cog },
  { href: "/contratos", label: "Contratos", icon: FileSignature },
  { href: "/planos", label: "Planos", icon: Layers },
  { href: "/helpdesk", label: "Help Desk", icon: Headset },
  { href: "/monitoramento", label: "Monitoramento", icon: MapPin, techOnly: true },
  { href: "/relatorios", label: "Relatórios", icon: PieChart },
  { href: "/ps", label: "PS", icon: FileText },
  { href: "/venda-avulsa", label: "Venda Avulsa", icon: ShoppingCart },
  { href: "/cofre", label: "Cofre de Senhas", icon: Lock },
  { href: "/conhecimento", label: "Conhecimento", icon: GraduationCap },
  { href: "/inventario", label: "Inventário", icon: Boxes },
  { href: "/orcamentos", label: "Orçamentos", icon: FileSpreadsheet },
  { href: "/usuarios", label: "Usuários", icon: UserCog },
  { href: "/configuracoes", label: "Configurações", icon: Settings, adminOnly: true },
];
