import {
  filterAnswersForPrint,
  resolvePrintFontScale,
  resolveMesaQrPrintSize,
  resolvePrintQrModuleSize,
  resolvePrintStoredFieldIds,
} from "../printFields";

describe("printFields", () => {
  const fields: any[] = [
    { id: 1, order: 0, label: "Nome", metadata: { isAutoField: true, autoFieldType: "name" } },
    { id: 2, order: 1, label: "Telefone", fieldType: "phone", metadata: { isAutoField: true, autoFieldType: "phone" } },
    { id: 3, order: 2, label: "Endereço", fieldType: "text" },
    { id: 4, order: 3, label: "Complemento", fieldType: "text" },
  ];

  it("filtra respostas pelos campos selecionados para impressão", () => {
    const answers = [
      { fieldId: 3, label: "Endereço", answer: "Rua A" },
      { fieldId: 4, label: "Complemento", answer: "Ap 12" },
      { fieldId: -1, label: "Mensagem automática", answer: "Sem cebola" },
    ];
    const filtered = filterAnswersForPrint(answers, fields, [3]);
    expect(filtered).toEqual([
      { fieldId: 3, label: "Endereço", answer: "Rua A" },
      { fieldId: -1, label: "Mensagem automática", answer: "Sem cebola" },
    ]);
  });

  it("usa todos os elegíveis quando printStoredFieldIds não está definido", () => {
    expect(resolvePrintStoredFieldIds({}, fields)).toEqual([3, 4]);
  });

  it("limita tamanho do QR térmico entre 4 e 16", () => {
    expect(resolvePrintQrModuleSize({ printQrModuleSize: 2 })).toBe(4);
    expect(resolvePrintQrModuleSize({ printQrModuleSize: 20 })).toBe(16);
  });

  it("limita tamanho do QR de mesa entre 80 e 280", () => {
    expect(resolveMesaQrPrintSize({ mesaQrPrintSize: 50 })).toBe(80);
    expect(resolveMesaQrPrintSize({ mesaQrPrintSize: 400 })).toBe(280);
  });

  it("limita escala da fonte do cupom entre 1 e 3", () => {
    expect(resolvePrintFontScale({ printFontScale: 0 })).toBe(1);
    expect(resolvePrintFontScale({ printFontScale: 2 })).toBe(2);
    expect(resolvePrintFontScale({ printFontScale: 9 })).toBe(3);
  });
});
