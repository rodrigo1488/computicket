import { buildCustomerSnapshot } from "../../../helpers/buildCustomerSnapshot";

describe("buildCustomerSnapshot", () => {
  it("prioriza autoFieldType address sobre label customizado", () => {
    const fields: any[] = [
      { id: 1, label: "Logradouro completo", metadata: { autoFieldType: "address" }, isRequired: true },
      { id: 2, label: "Nome", metadata: { autoFieldType: "name" }, isRequired: true },
    ];
    const answers = [
      { fieldId: 1, answer: "Rua das Flores" },
      { fieldId: 2, answer: "Maria" },
    ];
    const snap = buildCustomerSnapshot(fields, answers, {}, "Maria", "5511999999999");
    expect(snap.endereco).toBe("Rua das Flores");
    expect(snap.customerName).toBe("Maria");
  });
});
