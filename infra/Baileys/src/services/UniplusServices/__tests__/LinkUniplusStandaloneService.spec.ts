jest.mock("../../../models/Product", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock("../ReleaseUniplusCodigoService", () => ({
  __esModule: true,
  releaseUniplusCodigo: jest.fn(),
}));

import LinkUniplusStandaloneService from "../LinkUniplusStandaloneService";

const Product = require("../../../models/Product").default;
const { releaseUniplusCodigo } = require("../ReleaseUniplusCodigoService");

describe("LinkUniplusStandaloneService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    releaseUniplusCodigo.mockResolvedValue({ clearedOptionIds: [] });
  });

  it("cria novo produto avulso com grupo customizado", async () => {
    Product.create.mockResolvedValue({ id: 42 });

    const result = await LinkUniplusStandaloneService({
      companyId: 1,
      codigo: "123",
      nome: "Suco de Laranja",
      preco: 8,
      grupo: "Bebidas",
    });

    expect(releaseUniplusCodigo).toHaveBeenCalledWith(1, "123", {
      exceptProductId: undefined,
    });
    expect(Product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Suco de Laranja",
        value: 8,
        grupo: "Bebidas",
        idUniplus: "123",
        companyId: 1,
      })
    );
    expect(result).toEqual({
      productId: 42,
      action: "created",
      removedProductId: undefined,
    });
  });

  it("atualiza produto avulso existente (nome, preço, grupo, idUniplus)", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const target = {
      id: 10,
      name: "old",
      value: 1,
      grupo: "Outros",
      idUniplus: null,
      save,
    };
    Product.findOne.mockResolvedValue(target);

    const result = await LinkUniplusStandaloneService({
      companyId: 1,
      codigo: "456",
      nome: "Coca-Cola Lata",
      preco: 6.5,
      grupo: "Bebidas",
      productId: 10,
    });

    expect(releaseUniplusCodigo).toHaveBeenCalledWith(1, "456", {
      exceptProductId: 10,
    });
    expect(target.name).toBe("Coca-Cola Lata");
    expect(target.value).toBe(6.5);
    expect(target.grupo).toBe("Bebidas");
    expect(target.idUniplus).toBe("456");
    expect(save).toHaveBeenCalled();
    expect(result).toEqual({
      productId: 10,
      action: "updated",
      removedProductId: undefined,
    });
  });

  it("reaproveita codigo que estava numa option (release limpa a option, avulso é criado normalmente)", async () => {
    releaseUniplusCodigo.mockResolvedValue({
      clearedOptionIds: [99],
      removedProductId: undefined,
    });
    Product.create.mockResolvedValue({ id: 55 });

    const result = await LinkUniplusStandaloneService({
      companyId: 1,
      codigo: "789",
      nome: "Pizza G Avulsa",
      preco: 45,
      grupo: "Pizzas",
    });

    expect(releaseUniplusCodigo).toHaveBeenCalledWith(1, "789", {
      exceptProductId: undefined,
    });
    expect(Product.create).toHaveBeenCalledWith(
      expect.objectContaining({ idUniplus: "789" })
    );
    expect(result.productId).toBe(55);
    expect(result.action).toBe("created");
  });

  it("propaga removedProductId quando havia um standalone anterior com o mesmo codigo", async () => {
    releaseUniplusCodigo.mockResolvedValue({
      clearedOptionIds: [],
      removedProductId: 77,
    });
    Product.create.mockResolvedValue({ id: 88 });

    const result = await LinkUniplusStandaloneService({
      companyId: 1,
      codigo: "321",
      nome: "Novo Nome",
      preco: 10,
    });

    expect(result.removedProductId).toBe(77);
  });
});
