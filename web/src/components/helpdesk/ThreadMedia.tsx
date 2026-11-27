"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MediaViewerItem } from "@/components/media/MediaViewer";
import { helpdesk, publicMediaUrl, type HelpdeskMessage } from "@/lib/helpdesk";
import { mediaKind } from "@/lib/helpdeskMedia";

type MessagesCache = { messages?: HelpdeskMessage[]; [key: string]: unknown };

export function ThreadMedia({
  mediaUrl,
  mediaType,
  onReady,
  onOpen,
}: {
  mediaUrl: string;
  mediaType?: string | null;
  onReady?: () => void;
  onOpen?: (item: MediaViewerItem) => void;
}) {
  const src = publicMediaUrl(mediaUrl) || mediaUrl;
  const kind = mediaKind(mediaType, src);
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className="mb-1 block max-h-56 max-w-full cursor-zoom-in rounded-md object-contain"
        onLoad={onReady}
        onClick={() => onOpen?.({ src, kind: "image" })}
      />
    );
  }
  if (kind === "audio") {
    return (
      <audio
        controls
        preload="metadata"
        src={src}
        aria-label="Áudio"
        className="mb-1 block h-11 w-full"
        onLoadedMetadata={onReady}
      />
    );
  }
  if (kind === "video") {
    return (
      <div className="relative mb-1 inline-block max-w-[280px]">
        <video
          controls
          playsInline
          preload="metadata"
          src={src}
          aria-label="Vídeo"
          className="block max-h-64 w-full rounded-md bg-black"
          onLoadedMetadata={onReady}
        />
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen({ src, kind: "video" })}
            className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-black/80"
          >
            Ampliar
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" className="mb-1 block text-xs text-brand underline">
      Abrir anexo
    </a>
  );
}

export function AudioTranscript({
  message,
  conversationId,
  queryKeys,
}: {
  message: HelpdeskMessage;
  conversationId: number;
  queryKeys?: readonly (readonly unknown[])[];
}) {
  const qc = useQueryClient();
  const patchCaches = (patch: Partial<HelpdeskMessage>) => {
    const apply = (prev: MessagesCache | undefined): MessagesCache => ({
      ...prev,
      messages: (prev?.messages || []).map((row) =>
        String(row.id) === String(message.id) ? { ...row, ...patch } : row,
      ),
    });
    const keys = queryKeys ?? [
      ["hd-messages", conversationId],
      ["hd-messages", "history", conversationId],
    ];
    for (const key of keys) {
      qc.setQueryData<MessagesCache>(key, apply);
    }
  };
  const transcribe = useMutation({
    mutationFn: () => helpdesk.transcribeMessage(conversationId, String(message.id), true),
    onMutate: () => {
      patchCaches({ transcriptionStatus: "pending", transcriptionError: null });
    },
    onSuccess: (res) => {
      patchCaches({
        transcription: res.transcription || message.transcription,
        transcriptionStatus: res.transcription ? "completed" : message.transcriptionStatus,
      });
    },
    onError: (err: Error) => {
      patchCaches({ transcriptionStatus: "failed", transcriptionError: err.message });
    },
  });

  const text = (message.transcription || "").trim();
  const status = transcribe.isPending ? "pending" : message.transcriptionStatus;

  if (text) {
    return (
      <p className="mt-1 text-xs leading-relaxed text-ink/90">
        <span className="font-medium text-muted">Transcrição: </span>
        {text}
      </p>
    );
  }
  if (status === "pending") {
    return <p className="mt-1 text-[11px] text-muted">Transcrevendo áudio…</p>;
  }
  if (status === "failed") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <p className="text-[11px] text-open">Não foi possível transcrever</p>
        <button
          type="button"
          onClick={() => transcribe.mutate()}
          className="text-[11px] font-semibold text-brand hover:underline"
        >
          Tentar de novo
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => transcribe.mutate()}
      className="mt-1 text-[11px] font-semibold text-brand hover:underline"
    >
      Transcrever
    </button>
  );
}
