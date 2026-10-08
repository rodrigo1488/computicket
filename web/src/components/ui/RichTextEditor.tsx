"use client";

import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Highlighter,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Palette,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { toEditorHtml } from "@/lib/rich-text";

const SAFE_LINK_RE = /^(?:https?:\/\/|mailto:|tel:)/i;

/** Normaliza a URL digitada: adiciona https:// e aceita apenas http/https/mailto/tel. */
function normalizeLinkUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (SAFE_LINK_RE.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null; // outro esquema (javascript:, data:...) → recusa
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  return `https://${v.replace(/^\/+/, "")}`;
}

type Props = {
  /** HTML (ou texto puro legado) atual. */
  value: string;
  /** Recebe HTML do editor ("" quando vazio). O backend sanitiza novamente ao salvar. */
  onChange: (html: string) => void;
  placeholder?: string;
  /** Barra de ferramentas e altura reduzidas (ex.: itens do orçamento). */
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
};

function ToolbarButton({
  title,
  onClick,
  active,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // mantém a seleção do editor ao clicar
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-line hover:text-ink disabled:pointer-events-none disabled:opacity-30",
        active && "bg-line text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-4 w-px bg-line" aria-hidden />;
}

function ColorButton({
  title,
  icon,
  value,
  onPick,
}: {
  title: string;
  icon: ReactNode;
  value: string;
  onPick: (color: string) => void;
}) {
  return (
    <label
      title={title}
      className="relative inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-line hover:text-ink"
    >
      {icon}
      <span className="absolute right-1 bottom-1 left-1 h-0.5 rounded" style={{ backgroundColor: value }} aria-hidden />
      <input
        type="color"
        aria-label={title}
        value={value}
        onChange={(e) => onPick(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}

function Toolbar({ editor, compact }: { editor: Editor; compact?: boolean }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const [textColor, setTextColor] = useState("#dc2626");
  const [markColor, setMarkColor] = useState("#fde047");

  const s = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed.isActive("bold"),
      italic: ed.isActive("italic"),
      underline: ed.isActive("underline"),
      strike: ed.isActive("strike"),
      bullet: ed.isActive("bulletList"),
      ordered: ed.isActive("orderedList"),
      quote: ed.isActive("blockquote"),
      link: ed.isActive("link"),
      left: ed.isActive({ textAlign: "left" }),
      center: ed.isActive({ textAlign: "center" }),
      right: ed.isActive({ textAlign: "right" }),
      justify: ed.isActive({ textAlign: "justify" }),
      heading: ([1, 2, 3] as const).find((level) => ed.isActive("heading", { level })) ?? 0,
      canUndo: ed.can().undo(),
      canRedo: ed.can().redo(),
    }),
  });

  function openLink() {
    const current = (editor.getAttributes("link").href as string | undefined) || "";
    setLinkUrl(current);
    setLinkError("");
    setLinkOpen(true);
  }

  function applyLink() {
    if (!linkUrl.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const href = normalizeLinkUrl(linkUrl);
    if (!href) {
      setLinkError("Use um link http(s), e-mail ou telefone.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  }

  const iconCls = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <div className="border-b border-line bg-wash/60">
      <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1" role="toolbar" aria-label="Formatação de texto">
        <select
          aria-label="Estilo do parágrafo"
          title="Estilo do parágrafo"
          value={s.heading}
          onChange={(e) => {
            const level = Number(e.target.value) as 0 | 1 | 2 | 3;
            const chain = editor.chain().focus();
            if (level === 0) chain.setParagraph().run();
            else chain.setHeading({ level }).run();
          }}
          className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs text-ink"
        >
          <option value={0}>Normal</option>
          <option value={1}>Título 1</option>
          <option value={2}>Título 2</option>
          <option value={3}>Título 3</option>
        </select>
        <Sep />
        <ToolbarButton title="Negrito (Ctrl+B)" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className={iconCls} />
        </ToolbarButton>
        <ToolbarButton title="Itálico (Ctrl+I)" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className={iconCls} />
        </ToolbarButton>
        <ToolbarButton
          title="Sublinhado (Ctrl+U)"
          active={s.underline}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className={iconCls} />
        </ToolbarButton>
        <ToolbarButton title="Tachado" active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className={iconCls} />
        </ToolbarButton>
        <ColorButton
          title="Cor do texto"
          icon={<Palette className={iconCls} />}
          value={textColor}
          onPick={(c) => {
            setTextColor(c);
            editor.chain().focus().setColor(c).run();
          }}
        />
        <ColorButton
          title="Cor de realce"
          icon={<Highlighter className={iconCls} />}
          value={markColor}
          onPick={(c) => {
            setMarkColor(c);
            editor.chain().focus().setHighlight({ color: c }).run();
          }}
        />
        <Sep />
        <ToolbarButton title="Lista com marcadores" active={s.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className={iconCls} />
        </ToolbarButton>
        <ToolbarButton title="Lista numerada" active={s.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className={iconCls} />
        </ToolbarButton>
        {!compact ? (
          <ToolbarButton title="Citação" active={s.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote className={iconCls} />
          </ToolbarButton>
        ) : null}
        <Sep />
        <ToolbarButton title="Alinhar à esquerda" active={s.left} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <AlignLeft className={iconCls} />
        </ToolbarButton>
        <ToolbarButton title="Centralizar" active={s.center} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <AlignCenter className={iconCls} />
        </ToolbarButton>
        <ToolbarButton title="Alinhar à direita" active={s.right} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <AlignRight className={iconCls} />
        </ToolbarButton>
        <ToolbarButton title="Justificar" active={s.justify} onClick={() => editor.chain().focus().setTextAlign("justify").run()}>
          <AlignJustify className={iconCls} />
        </ToolbarButton>
        <Sep />
        <ToolbarButton title="Inserir/editar link" active={s.link} onClick={openLink}>
          <Link2 className={iconCls} />
        </ToolbarButton>
        <ToolbarButton
          title="Remover link"
          disabled={!s.link}
          onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}
        >
          <Link2Off className={iconCls} />
        </ToolbarButton>
        <Sep />
        <ToolbarButton title="Desfazer (Ctrl+Z)" disabled={!s.canUndo} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className={iconCls} />
        </ToolbarButton>
        <ToolbarButton title="Refazer (Ctrl+Y)" disabled={!s.canRedo} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className={iconCls} />
        </ToolbarButton>
        <ToolbarButton
          title="Limpar formatação"
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().run()}
        >
          <RemoveFormatting className={iconCls} />
        </ToolbarButton>
      </div>
      {linkOpen ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-2 py-1.5">
          <input
            autoFocus
            value={linkUrl}
            onChange={(e) => {
              setLinkUrl(e.target.value);
              setLinkError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                setLinkOpen(false);
                editor.commands.focus();
              }
            }}
            placeholder="https://exemplo.com"
            aria-label="Endereço do link"
            className="min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
          />
          <button type="button" onClick={applyLink} className="rounded-md bg-inverse px-2.5 py-1 text-xs text-on-inverse">
            Aplicar
          </button>
          <button
            type="button"
            onClick={() => {
              setLinkOpen(false);
              editor.commands.focus();
            }}
            className="rounded-md px-2 py-1 text-xs text-muted hover:text-ink"
          >
            Cancelar
          </button>
          {linkError ? <span className="w-full text-xs text-open">{linkError}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Editor de texto rico estilo Word (Tiptap). Emite HTML; o backend sanitiza ao salvar
 * e a exibição sanitiza novamente (ver `RichTextContent`).
 */
export function RichTextEditor({ value, onChange, placeholder, compact, className, ariaLabel }: Props) {
  // último HTML emitido por este editor — evita reaplicar o próprio valor e perder o cursor
  const lastEmitted = useRef<string>(value);

  const editor = useEditor({
    immediatelyRender: false, // Next/SSR
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
          isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && SAFE_LINK_RE.test(url),
        },
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: placeholder || "" }),
    ],
    content: toEditorHtml(value),
    editorProps: {
      attributes: {
        class: cn("rich-text focus:outline-none", compact ? "min-h-[3.5rem]" : "min-h-[7rem]"),
        role: "textbox",
        "aria-multiline": "true",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? "" : ed.getHTML();
      lastEmitted.current = html;
      onChange(html);
    },
  });

  // valor trocado por fora (ex.: rascunho gerado por IA)
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(toEditorHtml(value), { emitUpdate: false });
  }, [editor, value]);

  return (
    <div
      className={cn(
        "rich-text-editor overflow-hidden rounded-lg border border-line bg-surface focus-within:border-brand",
        className,
      )}
    >
      {editor ? <Toolbar editor={editor} compact={compact} /> : <div className="h-9 border-b border-line bg-wash/60" />}
      <div className={cn("px-3 py-2 text-sm text-ink", compact ? "max-h-56 overflow-y-auto" : "max-h-[28rem] overflow-y-auto")}>
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className={compact ? "min-h-[3.5rem]" : "min-h-[7rem]"} />
        )}
      </div>
    </div>
  );
}
