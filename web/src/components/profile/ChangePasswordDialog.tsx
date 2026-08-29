"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PrimaryButton, UnderlineField } from "@/components/ui/UnderlineField";
import { flask } from "@/lib/api";

export function ChangePasswordDialog({
  open,
  onClose,
  onBack,
}: {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
}) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      await flask.post("/auth/api/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrent("");
      setNew("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao alterar senha");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Alterar senha" onBack={onBack}>
      <div className="space-y-6">
        <UnderlineField
          label="Senha atual"
          type="password"
          value={currentPassword}
          onChange={setCurrent}
          placeholder="Digite sua senha atual"
        />
        <UnderlineField
          label="Nova senha"
          type="password"
          value={newPassword}
          onChange={setNew}
          placeholder="Digite sua nova senha"
          hint="Mínimo de 6 dígitos"
        />
        {error ? <p className="text-sm text-open">{error}</p> : null}
        <PrimaryButton onClick={save} disabled={saving || newPassword.length < 6}>
          Salvar
        </PrimaryButton>
      </div>
    </Modal>
  );
}
