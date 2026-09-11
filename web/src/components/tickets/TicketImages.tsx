"use client";

import { ImagePlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { TicketImage } from "@/lib/format";

export function ticketImageSrc(image: TicketImage) {
  const url = image.url || `/tickets/api/attachments/${image.id}`;
  return url.startsWith("/flask") ? url : `/flask${url}`;
}

export function TicketImagePicker({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (!file.type.startsWith("image/")) continue;
      if (next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) {
        continue;
      }
      next.push(file);
    }
    onChange(next.slice(0, 12));
  };

  return (
    <div>
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Imagens</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {files.map((file, index) => (
          <PendingThumb
            key={`${file.name}-${file.lastModified}-${index}`}
            file={file}
            onRemove={() => onChange(files.filter((_, i) => i !== index))}
          />
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-muted hover:bg-wash disabled:opacity-40"
        >
          <ImagePlus className="h-5 w-5" />
          <span className="text-[10px]">Adicionar</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function PendingThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="relative h-20 w-20 overflow-hidden rounded-xl border border-line">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={file.name} className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
        aria-label="Remover imagem"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function TicketImageGallery({
  images,
  canEdit,
  onRemove,
}: {
  images: TicketImage[];
  canEdit?: boolean;
  onRemove?: (id: number) => void;
}) {
  const [open, setOpen] = useState<TicketImage | null>(null);
  if (!images.length) return null;
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {images.map((image) => (
          <div key={image.id} className="relative h-20 w-20 overflow-hidden rounded-xl border border-line">
            <button type="button" className="h-full w-full" onClick={() => setOpen(image)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ticketImageSrc(image)} alt={image.filename} className="h-full w-full object-cover" />
            </button>
            {canEdit && onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(image.id)}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"
                aria-label="Remover imagem"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.filename || "Imagem"}>
        {open ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ticketImageSrc(open)} alt={open.filename} className="max-h-[70vh] w-full object-contain" />
        ) : null}
      </Modal>
    </>
  );
}
