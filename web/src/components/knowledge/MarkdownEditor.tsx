"use client";

import {
  Bold,
  Code,
  Code2,
  Columns2,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pencil,
  Quote,
  Strikethrough,
  Table,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { flask } from "@/lib/api";
import { cn } from "@/lib/cn";
import { MarkdownContent } from "@/components/knowledge/MarkdownContent";

type ViewMode = "write" | "split" | "preview";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

function ToggleToolButton({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-[32px] items-center justify-center rounded-md px-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface hover:text-ink disabled:pointer-events-none disabled:opacity-40",
        active && "bg-surface text-brand shadow-xs",
      )}
    >
      {children}
    </button>
  );
}

function ToolGroup({ children }: { children: ReactNode }) {
  return (
    <div
      role="group"
      className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-wash/70 p-0.5"
    >
      {children}
    </div>
  );
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Escreva o conteúdo do artigo em Markdown...",
  disabled = false,
  ariaLabel = "Conteúdo do artigo em Markdown",
}: Props) {
  const [mode, setMode] = useState<ViewMode>("write");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(320, el.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    if (mode !== "preview") {
      adjustHeight();
    }
  }, [value, mode, adjustHeight]);

  const applySelectionTransform = useCallback(
    (transform: (selected: string, before: string, after: string) => {
      text: string;
      selectStartOffset: number;
      selectEndOffset: number;
    }) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const before = value.slice(0, start);
      const selected = value.slice(start, end);
      const after = value.slice(end);
      const result = transform(selected, before, after);
      const nextValue = `${before}${result.text}${after}`;
      onChange(nextValue);

      requestAnimationFrame(() => {
        const target = textareaRef.current;
        if (!target) return;
        target.focus();
        target.setSelectionRange(start + result.selectStartOffset, start + result.selectEndOffset);
      });
    },
    [value, onChange],
  );

  const wrapInline = (prefix: string, suffix: string, fallback: string) => {
    applySelectionTransform((selected) => {
      const inner = selected || fallback;
      return {
        text: `${prefix}${inner}${suffix}`,
        selectStartOffset: prefix.length,
        selectEndOffset: prefix.length + inner.length,
      };
    });
  };

  const prefixLines = (linePrefix: string, fallback: string) => {
    applySelectionTransform((selected, before) => {
      const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
      const lead = needsLeadingNewline ? "\n" : "";
      const content = selected || fallback;
      const formatted = content
        .split("\n")
        .map((line, idx) => {
          if (linePrefix === "1. ") return `${idx + 1}. ${line.replace(/^\d+[.)]\s+/, "")}`;
          return `${linePrefix}${line.replace(/^#{1,6}\s+/, "")}`;
        })
        .join("\n");
      return {
        text: `${lead}${formatted}`,
        selectStartOffset: lead.length,
        selectEndOffset: lead.length + formatted.length,
      };
    });
  };

  const insertBlock = (block: string) => {
    applySelectionTransform((_, before) => {
      const lead = before.length > 0 && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
      return {
        text: `${lead}${block}`,
        selectStartOffset: lead.length,
        selectEndOffset: lead.length + block.length,
      };
    });
  };

  const uploadImageFile = async (file: File) => {
    setUploadError("");
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await flask.post<{ url: string; filename: string }>("/api/web/knowledge/media", fd);
      const alt = (res.filename || file.name || "imagem").replace(/\.[^.]+$/, "");
      insertBlock(`![${alt}](${res.url})`);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Erro ao enviar imagem.");
    } finally {
      setUploadingImage(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface focus-within:border-brand">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-wash/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <ToolGroup>
            <ToggleToolButton title="Título 1" disabled={disabled || mode === "preview"} onClick={() => prefixLines("# ", "Título principal")}>
              <Heading1 className="h-4 w-4" />
            </ToggleToolButton>
            <ToggleToolButton title="Título 2" disabled={disabled || mode === "preview"} onClick={() => prefixLines("## ", "Subtítulo")}>
              <Heading2 className="h-4 w-4" />
            </ToggleToolButton>
            <ToggleToolButton title="Título 3" disabled={disabled || mode === "preview"} onClick={() => prefixLines("### ", "Seção")}>
              <Heading3 className="h-4 w-4" />
            </ToggleToolButton>
          </ToolGroup>

          <ToolGroup>
            <ToggleToolButton title="Negrito (Ctrl+B)" disabled={disabled || mode === "preview"} onClick={() => wrapInline("**", "**", "texto em negrito")}>
              <Bold className="h-4 w-4" />
            </ToggleToolButton>
            <ToggleToolButton title="Itálico (Ctrl+I)" disabled={disabled || mode === "preview"} onClick={() => wrapInline("*", "*", "texto em itálico")}>
              <Italic className="h-4 w-4" />
            </ToggleToolButton>
            <ToggleToolButton title="Tachado" disabled={disabled || mode === "preview"} onClick={() => wrapInline("~~", "~~", "texto tachado")}>
              <Strikethrough className="h-4 w-4" />
            </ToggleToolButton>
            <ToggleToolButton title="Código inline" disabled={disabled || mode === "preview"} onClick={() => wrapInline("`", "`", "comando")}>
              <Code className="h-4 w-4" />
            </ToggleToolButton>
          </ToolGroup>

          <ToolGroup>
            <ToggleToolButton title="Lista com marcadores" disabled={disabled || mode === "preview"} onClick={() => prefixLines("- ", "Item da lista")}>
              <List className="h-4 w-4" />
            </ToggleToolButton>
            <ToggleToolButton title="Lista numerada" disabled={disabled || mode === "preview"} onClick={() => prefixLines("1. ", "Primeiro passo")}>
              <ListOrdered className="h-4 w-4" />
            </ToggleToolButton>
            <ToggleToolButton title="Checklist" disabled={disabled || mode === "preview"} onClick={() => prefixLines("- [ ] ", "Tarefa")}>
              <ListChecks className="h-4 w-4" />
            </ToggleToolButton>
            <ToggleToolButton title="Citação" disabled={disabled || mode === "preview"} onClick={() => prefixLines("> ", "Observação importante")}>
              <Quote className="h-4 w-4" />
            </ToggleToolButton>
          </ToolGroup>

          <ToolGroup>
            <ToggleToolButton
              title="Bloco de código"
              disabled={disabled || mode === "preview"}
              onClick={() => wrapInline("```\n", "\n```", "// código aqui")}
            >
              <Code2 className="h-4 w-4" />
            </ToggleToolButton>
            <ToggleToolButton
              title="Tabela Markdown"
              disabled={disabled || mode === "preview"}
              onClick={() =>
                insertBlock("| Coluna 1 | Coluna 2 |\n| --- | --- |\n| Valor 1 | Valor 2 |")
              }
            >
              <Table className="h-4 w-4" />
            </ToggleToolButton>
            <ToggleToolButton title="Divisor horizontal" disabled={disabled || mode === "preview"} onClick={() => insertBlock("---")}>
              <Minus className="h-4 w-4" />
            </ToggleToolButton>
          </ToolGroup>

          <ToolGroup>
            <ToggleToolButton
              title="Inserir link"
              disabled={disabled || mode === "preview"}
              onClick={() => {
                applySelectionTransform((selected) => {
                  const label = selected || "texto do link";
                  return {
                    text: `[${label}](https://)`,
                    selectStartOffset: label.length + 3,
                    selectEndOffset: label.length + 11,
                  };
                });
              }}
            >
              <Link2 className="h-4 w-4" />
            </ToggleToolButton>
            <ToggleToolButton
              title="Inserir imagem"
              disabled={disabled || uploadingImage || mode === "preview"}
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
            </ToggleToolButton>
          </ToolGroup>
        </div>

        <ToolGroup>
          <ToggleToolButton title="Modo escrever" active={mode === "write"} onClick={() => setMode("write")}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Escrever
          </ToggleToolButton>
          <ToggleToolButton title="Modo dividido" active={mode === "split"} onClick={() => setMode("split")}>
            <Columns2 className="mr-1 h-3.5 w-3.5" />
            Dividido
          </ToggleToolButton>
          <ToggleToolButton title="Modo visualizar" active={mode === "preview"} onClick={() => setMode("preview")}>
            <Eye className="mr-1 h-3.5 w-3.5" />
            Visualizar
          </ToggleToolButton>
        </ToolGroup>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void uploadImageFile(file);
        }}
      />

      {uploadError ? (
        <p className="border-b border-line bg-open-bg px-3 py-1.5 text-xs text-open">{uploadError}</p>
      ) : null}
      {uploadingImage ? (
        <p className="border-b border-line bg-wash px-3 py-1.5 text-xs text-muted">Enviando imagem…</p>
      ) : null}

      <div className={cn("grid", mode === "split" ? "lg:grid-cols-2 lg:divide-x lg:divide-line" : "grid-cols-1")}>
        {mode !== "preview" ? (
          <textarea
            ref={textareaRef}
            aria-label={ariaLabel}
            disabled={disabled}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
                e.preventDefault();
                wrapInline("**", "**", "texto em negrito");
              } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
                e.preventDefault();
                wrapInline("*", "*", "texto em itálico");
              } else if (e.key === "Tab") {
                e.preventDefault();
                applySelectionTransform(() => ({
                  text: "  ",
                  selectStartOffset: 2,
                  selectEndOffset: 2,
                }));
              }
            }}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData?.items || []);
              const imgItem = items.find((item) => item.type.startsWith("image/"));
              if (imgItem) {
                const file = imgItem.getAsFile();
                if (file) {
                  e.preventDefault();
                  void uploadImageFile(file);
                }
              }
            }}
            placeholder={placeholder}
            rows={14}
            className="min-h-[320px] w-full resize-y bg-transparent p-4 font-mono text-sm leading-relaxed text-ink placeholder:text-muted focus:outline-none"
          />
        ) : null}

        {mode !== "write" ? (
          <div className="min-h-[320px] overflow-y-auto bg-surface p-5">
            <MarkdownContent
              content={value}
              fallback={<p className="text-sm italic text-muted">Nada para visualizar ainda…</p>}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
