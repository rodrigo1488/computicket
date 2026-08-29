import {
  buildPieceAgainEntriesFromAnswers,
  decodePieceAgainValue,
  filterPieceAgainPrefillByLabel,
  isPieceAgainStorableField,
  listPieceAgainStorableFields,
  resolvePieceAgainStoredFieldIds,
} from "../pieceAgainFields";

describe("pieceAgainFields", () => {
  const fields: any[] = [
    { id: 1, order: 0, label: "Nome", metadata: { isAutoField: true, autoFieldType: "name" } },
    { id: 2, order: 1, label: "Telefone", fieldType: "phone", metadata: { isAutoField: true, autoFieldType: "phone" } },
    { id: 3, order: 2, label: "Endereço", fieldType: "text" },
    { id: 4, order: 3, label: "Complemento", fieldType: "text" },
    { id: 5, order: 4, label: "CPF", fieldType: "text" },
  ];

  it("lista apenas campos customizados não sensíveis", () => {
    const storable = listPieceAgainStorableFields(fields);
    expect(storable.map((f) => f.id)).toEqual([3, 4]);
  });

  it("usa todos os elegíveis quando não há configuração", () => {
    expect(resolvePieceAgainStoredFieldIds({}, fields)).toEqual([3, 4]);
    expect(resolvePieceAgainStoredFieldIds({ pieceAgainStoredFieldIds: undefined }, fields)).toEqual([3, 4]);
  });

  it("lista vazia explícita não armazena campos", () => {
    expect(resolvePieceAgainStoredFieldIds({ pieceAgainStoredFieldIds: [] }, fields)).toEqual([]);
  });

  it("respeita pieceAgainStoredFieldIds configurado", () => {
    expect(
      resolvePieceAgainStoredFieldIds({ pieceAgainStoredFieldIds: [4] }, fields)
    ).toEqual([4]);
  });

  it("monta entries apenas dos campos selecionados", () => {
    const entries = buildPieceAgainEntriesFromAnswers(
      [
        { fieldId: 2, answer: "5511999999999" },
        { fieldId: 3, answer: "Rua A" },
        { fieldId: 4, answer: "Ap 12" },
      ],
      fields,
      [3]
    );
    expect(entries).toEqual([{ name: "Endereço", value: "Rua A" }]);
  });

  it("filtra prefillByLabel pelos campos armazenados", () => {
    const filtered = filterPieceAgainPrefillByLabel(
      { Endereço: "Rua A", Complemento: "Ap 12" },
      fields,
      [3]
    );
    expect(filtered).toEqual({ Endereço: "Rua A" });
  });

  it("decodifica valores json prefixados", () => {
    expect(decodePieceAgainValue('__json__:["A","B"]')).toEqual(["A", "B"]);
  });

  it("rejeita campo sensível mesmo se selecionado", () => {
    expect(isPieceAgainStorableField(fields[4])).toBe(false);
  });
});
