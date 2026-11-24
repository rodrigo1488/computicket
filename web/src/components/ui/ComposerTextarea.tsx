"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

export type ComposerTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & {
  maxHeight?: number;
  minHeight?: number;
  onSubmitShortcut?: () => void;
};

export const ComposerTextarea = forwardRef<HTMLTextAreaElement, ComposerTextareaProps>(
  function ComposerTextarea(
    {
      className,
      value,
      onChange,
      onKeyDown,
      maxHeight = 144,
      minHeight = 36,
      onSubmitShortcut,
      style,
      ...rest
    },
    ref,
  ) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement, []);

    const syncHeight = useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      el.style.height = "auto";
      const scrollHeight = el.scrollHeight;
      const clamped = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
      el.style.height = `${clamped}px`;
      el.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
    }, [maxHeight, minHeight]);

    useLayoutEffect(() => {
      syncHeight();
    }, [value, syncHeight]);

    useEffect(() => {
      const el = innerRef.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      let lastWidth = el.clientWidth;
      const observer = new ResizeObserver(() => {
        if (el.clientWidth !== lastWidth) {
          lastWidth = el.clientWidth;
          syncHeight();
        }
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, [syncHeight]);

    return (
      <textarea
        {...rest}
        ref={innerRef}
        rows={1}
        value={value}
        onChange={(e) => {
          onChange?.(e);
          syncHeight();
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (onSubmitShortcut) {
              onSubmitShortcut();
            } else {
              e.currentTarget.form?.requestSubmit();
            }
          }
        }}
        style={{ ...style, resize: "none" }}
        className={cn(
          "min-w-0 flex-1 resize-none rounded-lg border-0 px-3 py-2 text-sm leading-5 shadow-sm outline-none",
          className,
        )}
      />
    );
  },
);
