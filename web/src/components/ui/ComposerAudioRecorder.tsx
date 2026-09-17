"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  AUDIO_RECORDING_MAX_MS,
  audioRecorderErrorMessage,
  formatRecordingClock,
  isAudioRecordingSupported,
  pickRecorderMime,
  recordedAudioFile,
} from "@/lib/audio-recorder";

type RecorderStatus = "idle" | "recording" | "stopping";

export function useAudioRecorder(opts?: { onAutoStop?: (file: File) => void }) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const mimeRef = useRef("");
  const stopWaitersRef = useRef<Array<(file: File | null) => void>>([]);
  const onAutoStopRef = useRef(opts?.onAutoStop);
  onAutoStopRef.current = opts?.onAutoStop;

  const recording = status === "recording" || status === "stopping";

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const finish = useCallback(
    (file: File | null) => {
      const auto = stopWaitersRef.current.length === 0;
      releaseStream();
      recorderRef.current = null;
      chunksRef.current = [];
      mimeRef.current = "";
      startedAtRef.current = 0;
      setElapsedMs(0);
      setStatus("idle");
      const waiters = stopWaitersRef.current;
      stopWaitersRef.current = [];
      waiters.forEach((resolve) => resolve(file));
      if (auto && file) onAutoStopRef.current?.(file);
    },
    [releaseStream],
  );

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder && !streamRef.current) return;
    stopWaitersRef.current.forEach((resolve) => resolve(null));
    stopWaitersRef.current = [];
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = () => finish(null);
      recorder.stop();
      setStatus("stopping");
      return;
    }
    finish(null);
  }, [finish]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return Promise.resolve<File | null>(null);
    }
    return new Promise<File | null>((resolve) => {
      stopWaitersRef.current.push(resolve);
      if (recorder.state === "recording") recorder.stop();
      setStatus("stopping");
    });
  }, []);

  const start = useCallback(async () => {
    if (!isAudioRecordingSupported()) {
      throw new Error("Este navegador não permite gravar áudio.");
    }
    if (recorderRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    try {
      streamRef.current = stream;
      const mime = pickRecorderMime();
      mimeRef.current = mime;
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => finish(null);
      recorder.onstop = () => {
        const type = mimeRef.current || recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: type.split(";")[0] });
        finish(recordedAudioFile(blob, type));
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setStatus("recording");
      recorder.start(250);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      throw error;
    }
  }, [finish]);

  useEffect(() => {
    if (status !== "recording") return;
    const tick = window.setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsedMs(ms);
      if (ms >= AUDIO_RECORDING_MAX_MS && recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
        setStatus("stopping");
      }
    }, 200);
    return () => window.clearInterval(tick);
  }, [status]);

  useEffect(() => () => cancel(), [cancel]);

  return {
    status,
    recording,
    elapsedMs,
    supported: isAudioRecordingSupported(),
    start,
    stop,
    cancel,
  };
}

export function ComposerMicButton({
  disabled,
  onClick,
  className,
}: {
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full text-brand hover:bg-wash disabled:opacity-40",
        className,
      )}
      aria-label="Gravar áudio"
      title="Gravar áudio"
    >
      <Mic className="h-5 w-5" />
    </button>
  );
}

export function ComposerRecordingBar({
  elapsedMs,
  sending,
  onCancel,
  onSend,
}: {
  elapsedMs: number;
  sending?: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={sending}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-open hover:bg-open-bg disabled:opacity-40"
        aria-label="Cancelar gravação"
        title="Cancelar"
      >
        <Trash2 className="h-5 w-5" />
      </button>
      <span className="inline-flex items-center gap-2 text-sm font-medium tabular-nums text-open">
        <span className="h-2 w-2 animate-pulse rounded-full bg-open" />
        {formatRecordingClock(elapsedMs)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted">Gravando áudio…</span>
      <button
        type="button"
        onClick={onSend}
        disabled={sending}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white disabled:opacity-40"
        aria-label="Enviar áudio"
        title="Enviar áudio"
      >
        {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
    </div>
  );
}

export { audioRecorderErrorMessage };
