"use client";

import {
  ArrowUpRight,
  Circle,
  Minus,
  MousePointer2,
  Paintbrush,
  Redo2,
  Send,
  Square,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";

export type MediaViewerKind = "image" | "video";

export type MediaViewerItem = {
  src: string;
  kind: MediaViewerKind;
  name?: string;
};

type Tool = "pan" | "brush" | "arrow" | "rect" | "ellipse" | "line" | "text";

type Point = { x: number; y: number };

type Annotation =
  | { type: "brush"; points: Point[]; color: string; width: number }
  | { type: "arrow"; a: Point; b: Point; color: string; width: number }
  | { type: "line"; a: Point; b: Point; color: string; width: number }
  | { type: "rect"; a: Point; b: Point; color: string; width: number }
  | { type: "ellipse"; a: Point; b: Point; color: string; width: number }
  | { type: "text"; at: Point; text: string; color: string; size: number };

const COLORS = ["#e11d48", "#f59e0b", "#16a34a", "#3b82f6", "#111827", "#ffffff"];
const WIDTHS = [3, 6, 10];

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function toCanvasPoint(el: HTMLCanvasElement, clientX: number, clientY: number): Point {
  const rect = el.getBoundingClientRect();
  const w = rect.width || 1;
  const h = rect.height || 1;
  return {
    x: ((clientX - rect.left) / w) * el.width,
    y: ((clientY - rect.top) / h) * el.height,
  };
}

function drawArrowHead(ctx: CanvasRenderingContext2D, a: Point, b: Point, width: number) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = Math.max(14, width * 4);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(angle - 0.45), b.y - head * Math.sin(angle - 0.45));
  ctx.lineTo(b.x - head * Math.cos(angle + 0.45), b.y - head * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}

function paintAnnotation(ctx: CanvasRenderingContext2D, item: Annotation) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (item.type === "brush") {
    if (item.points.length < 2) {
      const p = item.points[0];
      if (p) {
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, item.width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = item.width;
      ctx.beginPath();
      ctx.moveTo(item.points[0].x, item.points[0].y);
      for (let i = 1; i < item.points.length; i++) ctx.lineTo(item.points[i].x, item.points[i].y);
      ctx.stroke();
    }
  } else if (item.type === "line" || item.type === "arrow") {
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = item.width;
    ctx.beginPath();
    ctx.moveTo(item.a.x, item.a.y);
    ctx.lineTo(item.b.x, item.b.y);
    ctx.stroke();
    if (item.type === "arrow") drawArrowHead(ctx, item.a, item.b, item.width);
  } else if (item.type === "rect") {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.width;
    const x = Math.min(item.a.x, item.b.x);
    const y = Math.min(item.a.y, item.b.y);
    ctx.strokeRect(x, y, Math.abs(item.b.x - item.a.x), Math.abs(item.b.y - item.a.y));
  } else if (item.type === "ellipse") {
    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.width;
    const cx = (item.a.x + item.b.x) / 2;
    const cy = (item.a.y + item.b.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(item.b.x - item.a.x) / 2, Math.abs(item.b.y - item.a.y) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (item.type === "text") {
    ctx.fillStyle = item.color;
    ctx.font = `600 ${item.size}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(item.text, item.at.x, item.at.y);
  }
  ctx.restore();
}

function ToolBtn({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={!!active}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10",
        active && "bg-white/20 text-white",
      )}
    >
      {children}
    </button>
  );
}

export function MediaViewer({
  item,
  onClose,
  onResend,
  canResend = false,
}: {
  item: MediaViewerItem | null;
  onClose: () => void;
  onResend?: (file: File) => void;
  canResend?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<Tool>("pan");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(6);
  const [anns, setAnns] = useState<Annotation[]>([]);
  const [redo, setRedo] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [textEdit, setTextEdit] = useState<{ at: Point; clientX: number; clientY: number; value: string } | null>(
    null,
  );
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragPan = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const kind = item?.kind || "image";
  const editingImage = kind === "image" || !!imageSrc;
  const src = imageSrc || item?.src || "";

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setTool("pan");
    setAnns([]);
    setRedo([]);
    setDraft(null);
    setTextEdit(null);
    setImageSrc(null);
    setError(null);
  }, [item?.src, item?.kind]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (textEdit) setTextEdit(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [item, onClose, textEdit]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.naturalWidth) return;
    if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const a of anns) paintAnnotation(ctx, a);
    if (draft) paintAnnotation(ctx, draft);
  }, [anns, draft]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clamp(z * (e.deltaY > 0 ? 0.9 : 1.1), 0.25, 8));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [item]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  function commitText() {
    if (!textEdit) return;
    const value = textEdit.value.trim();
    if (value) {
      setAnns((prev) => [...prev, { type: "text", at: textEdit.at, text: value, color, size: Math.max(18, width * 6) }]);
      setRedo([]);
    }
    setTextEdit(null);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!editingImage) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (tool === "pan" || e.button === 1) {
      dragPan.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const p = toCanvasPoint(canvas, e.clientX, e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "text") {
      setTextEdit({ at: p, clientX: e.clientX, clientY: e.clientY, value: "" });
      return;
    }
    if (tool === "brush") setDraft({ type: "brush", points: [p], color, width });
    else if (tool === "arrow" || tool === "line") setDraft({ type: tool, a: p, b: p, color, width });
    else setDraft({ type: tool, a: p, b: p, color, width });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (dragPan.current) {
      setPan({
        x: dragPan.current.panX + (e.clientX - dragPan.current.x),
        y: dragPan.current.panY + (e.clientY - dragPan.current.y),
      });
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || !draft) return;
    const p = toCanvasPoint(canvas, e.clientX, e.clientY);
    if (draft.type === "brush") setDraft({ ...draft, points: [...draft.points, p] });
    else if (draft.type !== "text") setDraft({ ...draft, b: p });
  }

  function onPointerUp() {
    dragPan.current = null;
    if (draft) {
      setAnns((prev) => [...prev, draft]);
      setRedo([]);
      setDraft(null);
    }
  }

  async function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("Aguarde o vídeo carregar para capturar o quadro.");
      return;
    }
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setImageSrc(c.toDataURL("image/jpeg", 0.92));
    setTool("brush");
    setAnns([]);
    setRedo([]);
  }

  async function resend() {
    if (!onResend || !canResend) return;
    const img = imgRef.current;
    if (!img?.naturalWidth) {
      setError("Imagem ainda não carregou.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = document.createElement("canvas");
      out.width = img.naturalWidth;
      out.height = img.naturalHeight;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("Canvas indisponível");
      ctx.drawImage(img, 0, 0);
      for (const a of anns) paintAnnotation(ctx, a);
      const blob = await new Promise<Blob>((resolve, reject) => {
        out.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao gerar a imagem"))), "image/jpeg", 0.92);
      });
      onResend(new File([blob], `anotacao-${Date.now()}.jpg`, { type: "image/jpeg" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível reenviar");
    } finally {
      setBusy(false);
    }
  }

  if (!item) return null;

  const displaySrc = src;
  const showCanvas = editingImage;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/92 text-white">
      <header className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/10 px-2 py-1.5">
        <ToolBtn label="Fechar" onClick={onClose}>
          <X className="h-5 w-5" />
        </ToolBtn>
        <span className="mr-2 hidden truncate text-sm text-white/70 sm:inline">{item.name || "Mídia"}</span>
        <ToolBtn label="Diminuir zoom" onClick={() => setZoom((z) => clamp(z / 1.2, 0.25, 8))}>
          <ZoomOut className="h-4 w-4" />
        </ToolBtn>
        <button type="button" className="min-w-[3.5rem] text-center text-xs text-white/70" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
          {Math.round(zoom * 100)}%
        </button>
        <ToolBtn label="Aumentar zoom" onClick={() => setZoom((z) => clamp(z * 1.2, 0.25, 8))}>
          <ZoomIn className="h-4 w-4" />
        </ToolBtn>
        <span className="mx-1 h-5 w-px bg-white/15" />
        {showCanvas ? (
          <>
            <ToolBtn label="Mover" active={tool === "pan"} onClick={() => setTool("pan")}>
              <MousePointer2 className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn label="Pincel" active={tool === "brush"} onClick={() => setTool("brush")}>
              <Paintbrush className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn label="Texto" active={tool === "text"} onClick={() => setTool("text")}>
              <Type className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn label="Seta" active={tool === "arrow"} onClick={() => setTool("arrow")}>
              <ArrowUpRight className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn label="Linha" active={tool === "line"} onClick={() => setTool("line")}>
              <Minus className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn label="Retângulo" active={tool === "rect"} onClick={() => setTool("rect")}>
              <Square className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn label="Elipse" active={tool === "ellipse"} onClick={() => setTool("ellipse")}>
              <Circle className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              label="Desfazer"
              onClick={() =>
                setAnns((prev) => {
                  if (!prev.length) return prev;
                  const next = prev.slice(0, -1);
                  setRedo((r) => [prev[prev.length - 1], ...r]);
                  return next;
                })
              }
            >
              <Undo2 className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              label="Refazer"
              onClick={() =>
                setRedo((prev) => {
                  const first = prev[0];
                  if (!first) return prev;
                  setAnns((a) => [...a, first]);
                  return prev.slice(1);
                })
              }
            >
              <Redo2 className="h-4 w-4" />
            </ToolBtn>
            <span className="mx-1 hidden h-5 w-px bg-white/15 sm:block" />
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                onClick={() => setColor(c)}
                className={cn("h-6 w-6 rounded-full border border-white/30", color === c && "ring-2 ring-white")}
                style={{ background: c }}
              />
            ))}
            {WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWidth(w)}
                className={cn("px-1.5 text-[11px] text-white/70", width === w && "text-white")}
              >
                {w}px
              </button>
            ))}
          </>
        ) : (
          <button type="button" onClick={() => void captureFrame()} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20">
            Capturar quadro para editar
          </button>
        )}
        <span className="flex-1" />
        {canResend && onResend && showCanvas ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void resend()}
            className="mr-1 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {busy ? "Enviando…" : "Reenviar"}
          </button>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden" ref={stageRef}>
        <div
          className="absolute left-1/2 top-1/2"
          style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})` }}
        >
          {kind === "video" && !imageSrc ? (
            <video
              ref={videoRef}
              src={item.src}
              controls
              playsInline
              className="max-h-[80vh] max-w-[90vw] bg-black"
            />
          ) : (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={displaySrc}
                alt=""
                className="max-h-[80vh] max-w-[90vw] select-none object-contain"
                draggable={false}
                onLoad={() => redraw()}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 h-full w-full touch-none"
                style={{ cursor: tool === "pan" ? "grab" : tool === "text" ? "text" : "crosshair" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
          )}
        </div>
      </div>

      {textEdit ? (
        <input
          autoFocus
          value={textEdit.value}
          onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitText();
            if (e.key === "Escape") setTextEdit(null);
          }}
          onBlur={commitText}
          placeholder="Texto"
          className="fixed z-[81] rounded-md border border-white/30 bg-black/80 px-2 py-1 text-sm text-white outline-none"
          style={{ left: textEdit.clientX, top: textEdit.clientY }}
        />
      ) : null}

      {error ? <p className="shrink-0 bg-open px-3 py-1.5 text-center text-xs text-white">{error}</p> : null}
      {canResend ? null : (
        <p className="shrink-0 px-3 py-1.5 text-center text-[11px] text-white/50">
          {kind === "video" && !imageSrc
            ? "Use o zoom ou capture um quadro para anotar e reenviar."
            : "Abra um atendimento em andamento para reenviar a imagem anotada."}
        </p>
      )}
    </div>
  );
}
