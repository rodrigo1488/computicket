"use client";

import createDOMPurify, { type DOMPurify } from "dompurify";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

const MD_ALLOWED_TAGS = [
  "p", "div", "br", "hr", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "input",
  "b", "strong", "i", "em", "u", "s", "del", "mark",
  "a", "img",
  "table", "thead", "tbody", "tr", "th", "td",
];
const MD_ALLOWED_ATTR = ["href", "target", "rel", "src", "alt", "title", "class", "type", "checked", "disabled"];
const SAFE_SRC_RE = /^(?:https?:\/\/|\/flask\/api\/web\/knowledge\/media\/|\/)/i;
const SAFE_HREF_RE = /^(?:https?:\/\/|mailto:|tel:|\/)/i;

let mdPurifier: DOMPurify | null = null;

function getPurifier(): DOMPurify | null {
  if (typeof window === "undefined") return null;
  if (mdPurifier) return mdPurifier;
  const instance = createDOMPurify(window);
  instance.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toUpperCase();
    if (tag === "A") {
      const href = (node.getAttribute("href") || "").trim();
      if (!SAFE_HREF_RE.test(href)) {
        node.removeAttribute("href");
      } else {
        if (/^https?:\/\//i.test(href)) {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      }
    }
    if (tag === "IMG") {
      const src = (node.getAttribute("src") || "").trim();
      if (!SAFE_SRC_RE.test(src)) {
        node.remove();
        return;
      }
      node.setAttribute("loading", "lazy");
    }
    if (tag === "INPUT") {
      const type = (node.getAttribute("type") || "").toLowerCase();
      if (type !== "checkbox") {
        node.remove();
        return;
      }
      node.setAttribute("disabled", "");
    }
  });
  mdPurifier = instance;
  return instance;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(raw: string): string {
  const codeTokens: string[] = [];
  let text = raw.replace(/`([^`]+)`/g, (_, code) => {
    const idx = codeTokens.length;
    codeTokens.push(
      `<code class="rounded bg-wash px-1.5 py-0.5 font-mono text-[13px] text-ink">${escapeHtml(code)}</code>`,
    );
    return `\u0000CODE${idx}\u0000`;
  });

  text = escapeHtml(text);

  // Imagens ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr} class="my-4 max-w-full rounded-xl border border-line bg-surface shadow-sm" />`;
  });

  // Links [texto](url)
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, href, title) => {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(href)}"${titleAttr} class="font-medium text-brand underline underline-offset-2 hover:opacity-80">${label}</a>`;
  });

  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => codeTokens[Number(idx)] ?? "");
  return text;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Converte Markdown para HTML estruturado. */
export function markdownToHtml(markdown: string): string {
  const src = (markdown || "").replace(/\r\n?/g, "\n").trim();
  if (!src) return "";

  // Conteúdo HTML legado sem sintaxe markdown evidente
  if (/^\s*<(?:p|div|h[1-6]|ul|ol|blockquote|table|pre)\b/i.test(src) && !/^#{1,6}\s/m.test(src)) {
    return src;
  }

  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bloco de código cercado ```
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(
        `<pre class="my-3 overflow-x-auto rounded-xl border border-line bg-wash p-3.5 font-mono text-[13px] leading-relaxed text-ink"><code>${escapeHtml(
          codeLines.join("\n"),
        )}</code></pre>`,
      );
      continue;
    }

    // Linha em branco
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Divisor horizontal
    if (/^\s*(?:---|___|\*\*\*)\s*$/.test(line)) {
      out.push('<hr class="my-5 border-line" />');
      i += 1;
      continue;
    }

    // Cabeçalho # ... ######
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const lvl = heading[1].length;
      const clsMap: Record<number, string> = {
        1: "mt-6 mb-3 text-2xl font-bold text-navy border-b border-line pb-1.5",
        2: "mt-5 mb-2.5 text-xl font-semibold text-navy",
        3: "mt-4 mb-2 text-lg font-semibold text-navy",
        4: "mt-3 mb-1.5 text-base font-semibold text-navy",
        5: "mt-3 mb-1 text-sm font-semibold text-navy",
        6: "mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-muted",
      };
      out.push(`<h${lvl} class="${clsMap[lvl]}">${renderInline(heading[2].trim())}</h${lvl}>`);
      i += 1;
      continue;
    }

    // Tabela Markdown
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const thead = `<thead><tr class="border-b border-line bg-wash">${headers
        .map((h) => `<th class="px-3 py-2 text-left text-xs font-semibold text-navy">${renderInline(h)}</th>`)
        .join("")}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map(
          (r) =>
            `<tr class="border-t border-line">${headers
              .map((_, idx) => `<td class="px-3 py-2 text-sm text-ink">${renderInline(r[idx] ?? "")}</td>`)
              .join("")}</tr>`,
        )
        .join("")}</tbody>`;
      out.push(
        `<div class="my-4 overflow-x-auto rounded-xl border border-line"><table class="w-full border-collapse text-left text-sm">${thead}${tbody}</table></div>`,
      );
      continue;
    }

    // Citação >
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push(
        `<blockquote class="my-3 border-l-4 border-brand bg-wash/60 px-4 py-2.5 text-sm italic text-ink">${quoteLines
          .map((l) => renderInline(l))
          .join("<br />")}</blockquote>`,
      );
      continue;
    }

    // Lista não ordenada / checklist
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const rawItem = lines[i].replace(/^\s*[-*+]\s+/, "");
        const check = rawItem.match(/^\[( |x|X)\]\s+(.*)$/);
        if (check) {
          const checked = check[1].toLowerCase() === "x";
          items.push(
            `<li class="flex items-start gap-2"><input type="checkbox" ${checked ? "checked" : ""} disabled class="mt-1 accent-brand" /><span>${renderInline(check[2])}</span></li>`,
          );
        } else {
          items.push(`<li>${renderInline(rawItem)}</li>`);
        }
        i += 1;
      }
      const isChecklist = items.some((item) => item.includes('type="checkbox"'));
      out.push(
        `<ul class="${isChecklist ? "my-3 space-y-1.5 list-none pl-1" : "my-3 list-disc space-y-1 pl-6"} text-sm leading-relaxed text-ink">${items.join("")}</ul>`,
      );
      continue;
    }

    // Lista numerada
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
        i += 1;
      }
      out.push(`<ol class="my-3 list-decimal space-y-1 pl-6 text-sm leading-relaxed text-ink">${items.join("")}</ol>`);
      continue;
    }

    // Parágrafo comum (agrupa linhas consecutivas que não iniciam novo bloco)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*(?:---|___|\*\*\*)\s*$/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    out.push(`<p class="my-2.5 text-sm leading-relaxed text-ink">${paraLines.map(renderInline).join("<br />")}</p>`);
  }

  return out.join("\n");
}

export function MarkdownContent({
  content,
  className,
  fallback = null,
}: {
  content?: string | null;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className={cn("min-h-[2rem]", className)} />;
  }

  const rawHtml = markdownToHtml(content || "");
  const dp = getPurifier();
  const clean =
    dp && rawHtml
      ? String(
          dp.sanitize(rawHtml, {
            ALLOWED_TAGS: MD_ALLOWED_TAGS,
            ALLOWED_ATTR: MD_ALLOWED_ATTR,
            ALLOW_DATA_ATTR: false,
          }),
        )
      : "";

  if (!clean.trim()) return <>{fallback}</>;

  return (
    <div
      className={cn("markdown-content max-w-none text-sm text-ink", className)}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
