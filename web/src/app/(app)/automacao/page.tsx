import { redirect } from "next/navigation";

export default function AutomacaoPage() {
  redirect("/configuracoes?tab=whatsapp&section=automacao");
}
