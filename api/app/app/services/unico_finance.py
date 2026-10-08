"""Operações de exclusão de movimentação financeira (PS) no Unico/PostgreSQL.

Usado pelo cancelamento de OS. A exclusão é por ``documento`` (ex.: ``PS/OS-123``),
a mesma chave usada ao registrar a PS (``insert_ps_with_transaction_control``).
"""
from __future__ import annotations

from ..blueprints.utils import connect_postgres


class UnicoFinanceBlocked(RuntimeError):
    """A movimentação existe no Unico mas não pode ser excluída com segurança."""


def check_finance_ps_deletable(ps_number: str) -> int | None:
    """Confere (somente leitura) o estado da movimentação ``ps_number`` no Unico.

    Retorna o nº de lançamentos encontrados (0 = já não existe → exclusão idempotente),
    ou ``None`` se não foi possível consultar diretamente (ex.: só há o agente Uniplus).
    Levanta ``UnicoFinanceBlocked`` se algum lançamento já foi baixado/pago (status
    diferente de 'A' ou saldo diferente do valor): nesse caso o estorno deve ser feito
    no próprio Unico, e nada é apagado automaticamente.
    """
    conn = connect_postgres()
    if not conn:
        return None
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT status, valor, saldo FROM financeiro WHERE documento = %s",
            (ps_number,),
        )
        rows = cursor.fetchall() or []
    finally:
        if cursor:
            cursor.close()
        conn.close()

    for status, valor, saldo in rows:
        paid = (status is not None and str(status).strip().upper() != "A") or (
            valor is not None and saldo is not None and float(saldo) != float(valor)
        )
        if paid:
            raise UnicoFinanceBlocked(
                f"A movimentação {ps_number} já foi baixada/paga no Unico. "
                "Estorne a baixa no Unico antes de cancelar a OS."
            )
    return len(rows)


def delete_finance_ps(ps_number: str) -> int | None:
    """Exclui do Unico a movimentação financeira ``ps_number``.

    Idempotente: se já não existir, retorna 0 sem erro. Retorna ``None`` quando o
    número de linhas excluídas é desconhecido (agente não informou).
    Qualquer falha de conexão/execução propaga como exceção (chamador decide 502).
    """
    from ..uniplus_jobs import agent_enabled, enqueue_and_wait

    if agent_enabled():
        result = enqueue_and_wait("delete_finance_ps", {"document": ps_number, "ps_number": ps_number})
        deleted = (result or {}).get("deleted")
        return int(deleted) if deleted is not None else None

    conn = connect_postgres()
    if not conn:
        raise RuntimeError("Não foi possível conectar ao PostgreSQL/Unico")
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM financeiro WHERE documento = %s", (ps_number,))
        deleted = cursor.rowcount
        conn.commit()
        return int(deleted) if deleted is not None and deleted >= 0 else None
    except Exception:
        conn.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        conn.close()
