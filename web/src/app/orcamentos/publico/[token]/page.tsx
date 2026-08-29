"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";

export default function PublicBudgetPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  useEffect(() => {
    if (!token) return;
    window.location.replace(`/flask/orcamentos/publico/${encodeURIComponent(token)}`);
  }, [token]);

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-canvas p-8">
      <p className="text-sm text-muted">Abrindo orçamento…</p>
    </div>
  );
}
