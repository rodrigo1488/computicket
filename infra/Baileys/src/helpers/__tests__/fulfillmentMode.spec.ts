import { inferFulfillmentMode } from "../fulfillmentMode";

describe("fulfillmentMode", () => {
  const fields: any[] = [
    { id: 10, label: "Tipo de pedido" },
    { id: 11, label: "Endereço" },
  ];

  it("identifica retirada no campo tipo de pedido", () => {
    expect(
      inferFulfillmentMode("delivery", fields, [{ fieldId: 10, answer: "Retirada" }])
    ).toBe("pickup");
  });

  it("identifica entrega no campo tipo de pedido", () => {
    expect(
      inferFulfillmentMode("delivery", fields, [{ fieldId: 10, answer: "Entrega" }])
    ).toBe("delivery");
  });

  it("mesa permanece mesa", () => {
    expect(
      inferFulfillmentMode("mesa", fields, [{ fieldId: 10, answer: "Mesa 5" }])
    ).toBe("mesa");
  });
});
