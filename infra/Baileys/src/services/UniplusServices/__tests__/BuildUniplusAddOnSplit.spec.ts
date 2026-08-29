import { groupLinkedAddons, buildObservacao } from "../BuildUniplusDeliveryPayloadService";

describe("UniPlus adicionais → CONTAMESAITEM próprio", () => {
  const addOnById = new Map<
    number,
    { id: number; idUniplus?: string | null; label?: string | null; value?: number | null }
  >([
    [1, { id: 1, idUniplus: "9101", label: "Bacon extra", value: 5 }],
    [2, { id: 2, idUniplus: null, label: "Cebola extra", value: 2 }],
  ]);

  it("item sem adicionais: sem grupos, sem sobra", () => {
    const { linkedGroups, unlinkedAddons } = groupLinkedAddons([], addOnById);
    expect(linkedGroups).toEqual([]);
    expect(unlinkedAddons).toEqual([]);
  });

  it("adicional não vinculado (sem idUniplus): fica todo em unlinkedAddons", () => {
    const addons = [{ addOnItemId: 2, label: "Cebola extra", value: 2 }];
    const { linkedGroups, unlinkedAddons } = groupLinkedAddons(addons, addOnById);
    expect(linkedGroups).toEqual([]);
    expect(unlinkedAddons).toEqual(addons);
  });

  it("adicional vinculado: agrupa por addOnItemId e soma quantidade", () => {
    const addons = [
      { addOnItemId: 1, label: "Bacon extra", value: 5 },
      { addOnItemId: 1, label: "Bacon extra", value: 5 },
    ];
    const { linkedGroups, unlinkedAddons } = groupLinkedAddons(addons, addOnById);
    expect(unlinkedAddons).toEqual([]);
    expect(linkedGroups).toEqual([
      { addOnItemId: 1, codigo: "9101", nome: "Bacon extra", qty: 2, unit: 5 },
    ]);
  });

  it("mix vinculado + não vinculado: separa corretamente", () => {
    const addons = [
      { addOnItemId: 1, label: "Bacon extra", value: 5 },
      { addOnItemId: 2, label: "Cebola extra", value: 2 },
    ];
    const { linkedGroups, unlinkedAddons } = groupLinkedAddons(addons, addOnById);
    expect(linkedGroups).toEqual([
      { addOnItemId: 1, codigo: "9101", nome: "Bacon extra", qty: 1, unit: 5 },
    ]);
    expect(unlinkedAddons).toEqual([addons[1]]);
  });

  it("a soma das linhas (pai + adicionais vinculados) preserva o total original", () => {
    const lineTotal = 30 + 5 + 5; // pizza 30 + 2x bacon extra (vinculado)
    const addons = [
      { addOnItemId: 1, label: "Bacon extra", value: 5 },
      { addOnItemId: 1, label: "Bacon extra", value: 5 },
    ];
    const { linkedGroups } = groupLinkedAddons(addons, addOnById);
    const linkedRawValue = linkedGroups.reduce((sum, g) => sum + g.unit * g.qty, 0);
    const parentValortotal = Math.max(0, lineTotal - linkedRawValue);
    const addonLinesTotal = linkedGroups.reduce((sum, g) => sum + g.unit * g.qty, 0);

    expect(parentValortotal).toBe(30);
    expect(parentValortotal + addonLinesTotal).toBe(lineTotal);
  });

  it("buildObservacao com addonsOverride só lista os adicionais não vinculados", () => {
    const addons = [
      { addOnItemId: 1, label: "Bacon extra", value: 5 },
      { addOnItemId: 2, label: "Cebola extra", value: 2 },
    ];
    const { unlinkedAddons } = groupLinkedAddons(addons, addOnById);
    const obs = buildObservacao(
      { addons },
      new Map(),
      unlinkedAddons
    );
    expect(obs).toContain("Cebola extra");
    expect(obs).not.toContain("Bacon extra");
  });

  it("buildObservacao sem override continua listando todos os adicionais (compat)", () => {
    const addons = [{ addOnItemId: 1, label: "Bacon extra", value: 5 }];
    const obs = buildObservacao({ addons }, new Map());
    expect(obs).toContain("Bacon extra");
  });
});
