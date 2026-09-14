/**
 * Depois que o fluxo abre um chamado no Computicket, o listener não deve
 * voltar a disparar o menu de setores nem reiniciar o FlowBuilder.
 */
export const hasOpenedComputicketChamado = (
  ticket: { dataWebhook?: unknown } | null | undefined
): boolean => {
  const webhook = (ticket?.dataWebhook || {}) as {
    variables?: { ticket_id?: string | number };
    ticket_id?: string | number;
  };
  const ticketId = webhook.variables?.ticket_id ?? webhook.ticket_id;
  return String(ticketId || "").trim().length > 0;
};
