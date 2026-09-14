import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Utilitários | Computicket",
  description: "Baixe arquivos disponibilizados pela equipe Computicket, sem precisar entrar no sistema.",
};

export default function UtilitariosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
