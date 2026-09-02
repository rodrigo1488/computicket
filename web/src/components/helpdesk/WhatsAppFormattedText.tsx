import { Fragment, type ReactNode } from "react";

/** Negrito estilo WhatsApp: *texto* → texto em bold (sem os asteriscos). */
const BOLD_RE = /\*(?!\s)([^*\n]+?)(?<!\s)\*/g;

export function WhatsAppFormattedText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(BOLD_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) {
      nodes.push(<Fragment key={`t${key}`}>{text.slice(last, idx)}</Fragment>);
      key += 1;
    }
    nodes.push(
      <strong key={`b${key}`} className="font-semibold">
        {match[1]}
      </strong>,
    );
    key += 1;
    last = idx + match[0].length;
  }
  if (last < text.length) {
    nodes.push(<Fragment key={`t${key}`}>{text.slice(last)}</Fragment>);
  }
  return nodes.length ? <>{nodes}</> : <>{text}</>;
}
