"use client";

import { Suspense } from "react";
import { HelpdeskWorkspace } from "@/components/helpdesk/HelpdeskWorkspace";

export default function HelpdeskPage() {
  return (
    <div className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
      <Suspense fallback={<p className="p-6 text-sm text-muted">Carregando Help Desk…</p>}>
        <HelpdeskWorkspace />
      </Suspense>
    </div>
  );
}
