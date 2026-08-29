import {
  BookOpen,
  Code,
  Database,
  FileText,
  Folder,
  HelpCircle,
  Lightbulb,
  Monitor,
  Settings,
  Shield,
  Star,
  Users,
  Wifi,
  Wrench,
  type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  folder: Folder,
  "folder-open": Folder,
  book: BookOpen,
  "book-open": BookOpen,
  wrench: Wrench,
  desktop: Monitor,
  laptop: Monitor,
  computer: Monitor,
  wifi: Wifi,
  network: Wifi,
  shield: Shield,
  question: HelpCircle,
  "circle-question": HelpCircle,
  star: Star,
  file: FileText,
  "file-alt": FileText,
  users: Users,
  cog: Settings,
  gear: Settings,
  lightbulb: Lightbulb,
  code: Code,
  database: Database,
};

export const KNOWLEDGE_ICON_OPTIONS: { value: string; label: string }[] = [
  { value: "fas fa-folder", label: "Pasta" },
  { value: "fas fa-book", label: "Livro" },
  { value: "fas fa-wrench", label: "Ferramenta" },
  { value: "fas fa-desktop", label: "Computador" },
  { value: "fas fa-wifi", label: "Rede" },
  { value: "fas fa-shield-alt", label: "Segurança" },
  { value: "fas fa-question-circle", label: "Dúvidas" },
  { value: "fas fa-star", label: "Destaque" },
  { value: "fas fa-file-alt", label: "Documento" },
  { value: "fas fa-users", label: "Pessoas" },
  { value: "fas fa-cog", label: "Configuração" },
  { value: "fas fa-lightbulb", label: "Ideia" },
  { value: "fas fa-code", label: "Código" },
  { value: "fas fa-database", label: "Banco de dados" },
];

export function knowledgeIcon(icon?: string | null): LucideIcon {
  const raw = (icon || "").toLowerCase();
  for (const [key, Component] of Object.entries(MAP)) {
    if (raw.includes(key)) return Component;
  }
  return Folder;
}
