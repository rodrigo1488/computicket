"use client";

import { Suspense } from "react";
import { InternalChatWorkspace } from "@/components/chat/InternalChatWorkspace";

export default function InternalChatPage() {
  return (
    <div className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
      <Suspense fallback={<p className="p-6 text-sm text-muted">Carregando chat…</p>}>
        <InternalChatWorkspace />
      </Suspense>
    </div>
  );
}
