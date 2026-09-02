"use client";

import { Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/ui/UserAvatar";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp";

function validateAvatarFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    return "Use PNG, JPG, GIF ou WebP.";
  }
  if (file.size > MAX_BYTES) {
    return "A imagem deve ter no máximo 5 MB.";
  }
  return null;
}

export function AvatarPicker({
  name,
  src,
  onFile,
  onRemove,
  busy = false,
}: {
  name: string;
  src?: string | null;
  onFile: (file: File) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  busy?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  useEffect(() => {
    setPreview(null);
    setLocalError("");
  }, [src]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const invalid = validateAvatarFile(file);
    if (invalid) {
      setLocalError(invalid);
      return;
    }
    setLocalError("");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    try {
      await onFile(file);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Erro ao enviar a imagem.");
      setPreview(null);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <UserAvatar name={name} src={preview || src || undefined} size="lg" />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg bg-wash px-3 py-2 text-sm text-ink disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {busy ? "Enviando…" : src || preview ? "Trocar foto" : "Adicionar foto"}
        </button>
        {onRemove && (src || preview) ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (preview) {
                URL.revokeObjectURL(preview);
                setPreview(null);
              }
              void onRemove();
            }}
            className="text-open disabled:opacity-50"
            aria-label="Remover foto"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      {localError ? <p className="text-sm text-open">{localError}</p> : null}
    </div>
  );
}
