import {
  buildProductDisplayName,
  collectVariationOptionIds,
  resolveMenuItemForMessage,
  resolveVariationOptionId,
} from "../FormatMenuOrderMessage";

describe("FormatMenuOrderMessage helpers", () => {
  const productMap = new Map([
    [10, { name: "Pizza Calabresa", value: 30, grupo: "Pizzas" }],
  ]);
  const optionMap = new Map([
    [101, { id: 101, label: "G", value: 45 }],
    [102, { id: 102, label: "M", value: 35 }],
  ]);

  it("resolve variationOptionId ou optionId", () => {
    expect(resolveVariationOptionId({ productId: 1, quantity: 1, variationOptionId: 101 })).toBe(101);
    expect(resolveVariationOptionId({ productId: 1, quantity: 1, optionId: 102 })).toBe(102);
  });

  it("monta nome com variação quando só veio productId + optionId", () => {
    const resolved = resolveMenuItemForMessage(
      {
        productId: 10,
        quantity: 1,
        productName: "Pizza Calabresa",
        optionId: 101,
      },
      productMap as any,
      optionMap as any
    );
    expect(resolved.productName).toBe("Pizza Calabresa - G");
    expect(resolved.productValue).toBe(45);
  });

  it("não duplica label se productName já contém variação", () => {
    const name = buildProductDisplayName("Pizza Calabresa", "Pizza Calabresa - G", "G");
    expect(name).toBe("Pizza Calabresa - G");
  });

  it("coleta optionIds de meio a meio e combo", () => {
    const ids = collectVariationOptionIds([
      {
        productId: 10,
        quantity: 1,
        type: "halfAndHalf",
        baseOptionId: 101,
        half2OptionId: 102,
      },
      {
        productId: 20,
        quantity: 1,
        type: "combo",
        comboItems: [{ productId: 30, variationOptionId: 102 }],
      },
    ]);
    expect(ids.sort()).toEqual([101, 102]);
  });
});
