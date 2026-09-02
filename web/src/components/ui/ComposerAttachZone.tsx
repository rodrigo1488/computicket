"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/cn";
import { dataTransferHasFiles, filesFromClipboard, filesFromDataTransfer } from "@/lib/composer-files";

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
