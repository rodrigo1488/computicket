import {
  buildCustomerSnapshot,
  deliveryAddressRequired,
} from "../buildCustomerSnapshot";

describe("deliveryAddressRequired", () => {
  const tipoPedido = { id: 10, order: 0, hasConditional: false, isRequired: true, label: "Tipo de pedido" };
  const endereco = {
    id: 11,
    order: 1,
    hasConditional: true,
    conditionalFieldId: 10,
    conditionalRules: { operator: "equals", value: "Entrega" },
    isRequired: true,
    label: "Endereço",
    metadata: { autoFieldType: "address" },
  };

  it("não exige endereço em retirada (pickup)", () => {
    const answers = [
      { fieldId: 10, answer: "Retirada" },
    ];
    expect(
      deliveryAddressRequired(
        [tipoPedido, endereco] as any,
        "delivery",
        answers,
        "pickup"
      )
    ).toBe(false);
  });

  it("não exige endereço quando campo condicional está oculto", () => {
    const answers = [{ fieldId: 10, answer: "Retirada" }];
    expect(
      deliveryAddressRequired([tipoPedido, endereco] as any, "delivery", answers)
    ).toBe(false);
  });

  it("exige endereço quando entrega e campo visível", () => {
    const answers = [{ fieldId: 10, answer: "Entrega" }];
    expect(
      deliveryAddressRequired([tipoPedido, endereco] as any, "delivery", answers, "delivery")
    ).toBe(true);
  });

  it("não exige endereço em pedido de mesa", () => {
    expect(deliveryAddressRequired([endereco] as any, "mesa", [])).toBe(false);
  });
});

describe("buildCustomerSnapshot pickup", () => {
  it("permite snapshot sem endereço", () => {
    const snap = buildCustomerSnapshot([], [], {}, "João", "5511999999999");
    expect(snap.endereco).toBe("");
    expect(snap.customerName).toBe("João");
  });
});
