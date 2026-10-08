import createDOMPurify, { type DOMPurify } from "dompurify";

/**
 * Utilitários de texto rico (orçamentos).
 *
 * O backend sanitiza ao salvar; aqui sanitizamos NOVAMENTE antes de exibir/editar
 * (defesa em profundidade). A whitelist espelha `api/app/app/rich_text_utils.py`.
 */

export const RICH_ALLOWED_TAGS = [
  "p", "div", "br", "hr", "blockquote", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "b", "strong", "i", "em", "u", "s", "strike", "del", "mark", "sub", "sup",
  "code", "span", "font", "a",
];
const RICH_ALLOWED_ATTR = ["href", "target", "rel", "style", "color"];
const BLOCK_TAGS = new Set(["P", "DIV", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "LI"]);
const TEXT_ALIGN = new Set(["left", "right", "center", "justify"]);
const NAMED_COLORS = new Set([
  "black", "white", "gray", "grey", "silver", "maroon", "red", "purple", "fuchsia", "green",
  "lime", "olive", "yellow", "navy", "blue", "teal", "aqua", "orange", "transparent", "inherit",
]);
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i;
const SAFE_HREF_RE = /^(?:https?:\/\/|mailto:|tel:)/i;
const HTML_HINT_RE = /<\s*\/?\s*[a-zA-Z!][^>]*>/;

function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (HEX_RE.test(v)) return v;
  const m = RGB_RE.exec(v);
  if (m) {
    const hex = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"));
    return `#${hex.join("")}`;
  }
  return NAMED_COLORS.has(v) ? v : null;
}

function cleanStyle(tagName: string, style: string): string {
  const out: string[] = [];
  for (const decl of style.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (prop === "color" || prop === "background-color") {
      const c = normalizeColor(val);
      if (c) out.push(`${prop}: ${c}`);
    } else if (prop === "text-align" && BLOCK_TAGS.has(tagName)) {
      if (TEXT_ALIGN.has(val.toLowerCase())) out.push(`text-align: ${val.toLowerCase()}`);
    }
  }
  return out.join("; ");
}

let purifier: DOMPurify | null = null;

function getPurifier(): DOMPurify | null {
  if (typeof window === "undefined") return null;
  if (purifier) return purifier;
  const instance = createDOMPurify(window);
  instance.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toUpperCase();
    // estilos: somente propriedades/valores da whitelist
    if (node.hasAttribute("style")) {
      const style = cleanStyle(tag, node.getAttribute("style") || "");
      if (style) node.setAttribute("style", style);
      else node.removeAttribute("style");
    }
    if (node.hasAttribute("color")) {
      const c = tag === "FONT" ? normalizeColor(node.getAttribute("color") || "") : null;
      if (c) node.setAttribute("color", c);
      else node.removeAttribute("color");
    }
    if (tag === "A") {
      const href = (node.getAttribute("href") || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
      if (!SAFE_HREF_RE.test(href)) {
        node.removeAttribute("href");
        node.removeAttribute("target");
        node.removeAttribute("rel");
      } else {
        node.setAttribute("href", href);
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    } else {
      node.removeAttribute("href");
      node.removeAttribute("target");
      node.removeAttribute("rel");
    }
  });
  purifier = instance;
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

/** Texto puro (legado) → HTML escapado preservando quebras de linha. */
export function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  return normalized
    .split(/\n\s*\n/)
    .map((para) => `<p>${para.split("\n").map((l) => escapeHtml(l.trimEnd())).join("<br>")}</p>`)
    .join("");
}

/**
 * Sanitiza HTML rico no cliente. Texto puro legado é convertido em HTML escapado.
 * No servidor (SSR) não há DOM: retorna "" — o componente de exibição preenche após montar.
 */
export function sanitizeRichHtml(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (!HTML_HINT_RE.test(raw)) return plainTextToHtml(raw);
  const dp = getPurifier();
  if (!dp) return "";
  const clean = dp.sanitize(raw, {
    ALLOWED_TAGS: RICH_ALLOWED_TAGS,
    ALLOWED_ATTR: RICH_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: SAFE_HREF_RE,
    KEEP_CONTENT: true,
    FORBID_CONTENTS: ["script", "style", "iframe", "object", "embed", "noscript", "template", "textarea", "svg", "math"],
  });
  return String(clean).trim();
}

/** true quando o HTML não tem texto visível (ex.: `<p></p>`). */
export function isRichTextEmpty(html?: string | null): boolean {
  if (!html) return true;
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .trim();
  return text.length === 0 && !/<hr\b/i.test(html);
}

/** Valor inicial do editor a partir do que veio da API (texto puro ou HTML). */
export function toEditorHtml(value?: string | null): string {
  return sanitizeRichHtml(value);
}
