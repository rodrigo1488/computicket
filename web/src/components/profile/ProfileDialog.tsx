"use client";

import { Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { flask } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ChangePasswordDialog } from "@/components/profile/ChangePasswordDialog";

export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, refresh } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && user) {
      setName(user.name);
      setEmail(user.email);
      setError("");
    }
  }, [open, user]);

  if (!user) return null;

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await flask.patch("/auth/api/me", { name, email });
      await refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    await flask.post("/auth/api/me/avatar", fd);
    await refresh();
  };

  const removeAvatar = async () => {
    await flask.delete("/auth/api/me/avatar");
    await refresh();
  };

  return (
    <>
      <Modal open={open && !passwordOpen} onClose={onClose} title="Perfil">
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <UserAvatar name={user.name} src={user.avatar_url || undefined} size="lg" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg bg-wash px-3 py-2 text-sm text-ink"
            >
              <Upload className="h-4 w-4" />
              Nova imagem
            </button>
            {user.avatar_url ? (
              <button type="button" onClick={removeAvatar} className="text-open" aria-label="Remover">
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
          </div>

          <UnderlineField label="Nome" value={name} onChange={setName} />
          <UnderlineField label="E-mail" value={email} onChange={setEmail} />

          <div>
            <span className="text-[11px] font-medium tracking-[0.08em] text-muted uppercase">Senha</span>
            <div className="mt-1 flex items-center gap-3 border-b border-line py-2">
              <span className="flex-1 tracking-widest text-ink">••••••••</span>
              <button
                type="button"
                onClick={() => setPasswordOpen(true)}
                className="rounded-lg bg-wash px-3 py-1.5 text-sm"
              >
                Alterar
              </button>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-ink">Disponibilidade</p>
            <p className="text-xs text-muted">Horários de atendimento definidos pelo admin</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(user.availability || []).length === 0 ? (
                <span className="text-sm text-muted">Nenhum horário definido</span>
              ) : (
                user.availability.map((h) => (
                  <span key={h} className="rounded-full border border-line px-3 py-1.5 text-sm text-ink">
                    {h}
                  </span>
                ))
              )}
            </div>
          </div>

          {error ? <p className="text-sm text-open">{error}</p> : null}
          <PrimaryButton onClick={save} disabled={saving}>
            Salvar
          </PrimaryButton>
        </div>
      </Modal>
      <ChangePasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onBack={() => setPasswordOpen(false)}
      />
    </>
  );
}
