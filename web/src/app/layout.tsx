import type { Metadata } from "next";
import { Providers } from "@/lib/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Computicket",
  description: "Plataforma de chamados Computicket",
};

const THEME_BOOTSTRAP = `(function(){try{var k="computicket.theme";function apply(t){var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}apply(localStorage.getItem(k)||"light");document.addEventListener("click",function(e){var b=e.target&&e.target.closest&&e.target.closest("[data-theme-toggle]");if(!b)return;var next=document.documentElement.classList.contains("dark")?"light":"dark";localStorage.setItem(k,next);apply(next);});}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full overflow-hidden" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full overflow-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
