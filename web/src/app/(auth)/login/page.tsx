"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { flask } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { ThemeQuickToggle } from "@/components/layout/ThemeToggle";

function LoginForm() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(params.get("next") || "/tickets");
  }, [loading, user, router, params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await flask.post("/auth/api/login", { email, password });
      await refresh();
      router.replace(params.get("next") || "/tickets");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-y-auto bg-canvas p-6">
      <ThemeQuickToggle className="absolute right-4 top-4 h-9 w-9 hover:bg-surface" />
      <form onSubmit={submit} className="w-full max-w-[420px] rounded-3xl bg-surface p-10 shadow-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Image src="/logo-light.jpg" alt="Computicket" width={220} height={220} className="h-auto w-40 object-contain" priority />
          <p className="mt-3 text-sm text-muted">Entre para continuar</p>
        </div>
        <div className="space-y-6">
          <UnderlineField label="E-mail" value={email} onChange={setEmail} placeholder="voce@empresa.com" />
          <UnderlineField label="Senha" type="password" value={password} onChange={setPassword} placeholder="••••••••" />
          {error ? <p className="text-sm text-open">{error}</p> : null}
          <PrimaryButton type="submit" disabled={saving}>
            Entrar
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
