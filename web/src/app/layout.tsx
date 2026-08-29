import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth-context";
import { QueryProvider } from "@/lib/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Computicket",
  description: "Plataforma de chamados Computicket",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full overflow-hidden">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full overflow-hidden">
        <QueryProvider>
          <AuthProvider>
            <div className="flex h-full min-h-0 flex-col overflow-hidden">{children}</div>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
