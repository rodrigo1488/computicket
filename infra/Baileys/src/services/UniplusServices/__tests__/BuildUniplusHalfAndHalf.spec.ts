import {
  buildObservacao,
  formatHalfFlavorLabel,
} from "../BuildUniplusDeliveryPayloadService";

describe("UniPlus meio a meio payload", () => {
  const productById = new Map<
    number,
    { id: number; name?: string | null; idUniplus?: string | null }
  >([
    [10, { id: 10, name: "Pizza G", idUniplus: "2000" }],
    [21, { id: 21, name: "Calabresa", idUniplus: "1002" }],
    [22, { id: 22, name: "Mussarela", idUniplus: "1003" }],
  ]);

  it("formata sabor com codigo UniPlus + nome", () => {
    expect(formatHalfFlavorLabel(21, productById)).toBe("1002 Calabresa");
    expect(formatHalfFlavorLabel(99, productById)).toBe("");
  });

  it("monta observacao estável com os dois sabores", () => {
    const obs = buildObservacao(
      {
        type: "halfAndHalf",
        productId: 10,
        half1ProductId: 21,
        half2ProductId: 22,
        productName: "Pizza G - Metade Calabresa / Metade Mussarela",
        quantity: 1,
        productValue: 50,
      },
      productById
    );

    expect(obs).toContain("Meio a meio: 1002 Calabresa / 1003 Mussarela");
    expect(obs.length).toBeLessThanOrEqual(255);
    // 1 linha CONTAMESAITEM: codigo do base fica no item; sabores na obs
    expect(obs).toMatch(/1002/);
    expect(obs).toMatch(/1003/);
  });

  it("coleta productIds de base + half1 + half2 (contrato 1 linha)", () => {
    const items = [
      {
        type: "halfAndHalf",
        productId: 10,
        half1ProductId: 21,
        half2ProductId: 22,
      },
    ];
    const productIds = [
      ...new Set(
        items
          .flatMap((it) => [
            Number(it.productId),
            Number(it.half1ProductId),
            Number(it.half2ProductId),
          ])
          .filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];
    expect(productIds.sort((a, b) => a - b)).toEqual([10, 21, 22]);
  });

  it("observacao cabe em 255 mesmo com nome longo (nomeproduto corta em 120)", () => {
    const longName =
      "Pizza G - Metade Calabresa Especial com Extra Bacon Crocante e Orégano / Metade Mussarela Premium com Borda Recheada de Catupiry e Tomate Seco";
    const obs = buildObservacao(
      {
        type: "halfAndHalf",
        productId: 10,
        half1ProductId: 21,
        half2ProductId: 22,
        productName: longName,
        quantity: 1,
        productValue: 55,
      },
      productById
    );
    expect(longName.length).toBeGreaterThan(120);
    expect(obs.length).toBeLessThanOrEqual(255);
    expect(obs).toContain("Meio a meio: 1002 Calabresa / 1003 Mussarela");
  });
});
