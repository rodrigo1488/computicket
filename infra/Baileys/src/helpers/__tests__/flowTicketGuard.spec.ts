import { hasOpenedComputicketChamado } from "../flowTicketGuard";

describe("hasOpenedComputicketChamado", () => {
  it("é falso quando o fluxo ainda não abriu chamado", () => {
    expect(hasOpenedComputicketChamado({ dataWebhook: null })).toBe(false);
    expect(hasOpenedComputicketChamado({ dataWebhook: { variables: {} } })).toBe(
      false
    );
  });

  it("é verdadeiro depois que o nó de ticket grava ticket_id", () => {
    expect(
      hasOpenedComputicketChamado({
        dataWebhook: { variables: { ticket_id: "3173" } }
      })
    ).toBe(true);
  });
});
