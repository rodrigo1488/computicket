"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { dataTransferHasFiles, filesFromClipboard, filesFromDataTransfer } from "@/lib/composer-files";

export function ComposerFilePreview({
  file,
  onClear,
}: {
  file: File;
  onClear: () => void;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const mime = (file.type || "").toLowerCase();
  const image = mime.startsWith("image/");
  const video = mime.startsWith("video/");
  const audio = mime.startsWith("audio/");

  return (
    <div className="mb-2 rounded-lg border border-line bg-wash p-2">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={file.name} className="mb-1.5 max-h-44 w-auto max-w-full rounded-md object-contain" />
      ) : null}
      {video ? <video src={url} controls className="mb-1.5 max-h-44 w-full rounded-md" /> : null}
      {audio ? <audio src={url} controls className="mb-1.5 block w-full" /> : null}
      <div className="flex items-center gap-2 text-xs text-ink">
        {!image && !video && !audio ? <FileText className="h-3.5 w-3.5 shrink-0 text-muted" /> : null}
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <button type="button" onClick={onClear} className="text-muted hover:text-ink" aria-label="Remover anexo">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ComposerAttachZone({
  enabled,
  onFiles,
  className,
  children,
}: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  function reset() {
    depth.current = 0;
    setOver(false);
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!enabled || !dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    depth.current += 1;
    setOver(true);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!enabled || !dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!enabled) return;
    event.preventDefault();
    event.stopPropagation();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (!enabled) return;
    event.preventDefault();
    event.stopPropagation();
    reset();
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length) onFiles(files);
  }

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPaste={(event) => {
        if (!enabled) return;
        const files = filesFromClipboard(event);
        if (!files.length) return;
        event.preventDefault();
        onFiles(files);
      }}
    >
      {children}
      {over ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-brand/15 ring-2 ring-inset ring-brand">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold text-brand shadow-sm">
            <Paperclip className="h-4 w-4" />
            Solte o arquivo para anexar
          </span>
        </div>
      ) : null}
    </div>
  );
}
