jest.mock("../../../models/AddOnItem", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock("../../../models/AddOnGroup", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

jest.mock("../ReleaseUniplusCodigoService", () => ({
  __esModule: true,
  releaseUniplusCodigo: jest.fn(),
}));

import LinkUniplusAddOnService from "../LinkUniplusAddOnService";

const AddOnItem = require("../../../models/AddOnItem").default;
const AddOnGroup = require("../../../models/AddOnGroup").default;
const { releaseUniplusCodigo } = require("../ReleaseUniplusCodigoService");

describe("LinkUniplusAddOnService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    releaseUniplusCodigo.mockResolvedValue({
      clearedOptionIds: [],
      removedProductId: undefined,
    });
  });

  it("vincula um adicional existente ao codigo informado", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const target = { id: 5, label: "Bacon extra", idUniplus: null, save };
    AddOnItem.findOne.mockResolvedValue(target);

    const result = await LinkUniplusAddOnService({
      companyId: 1,
      codigo: "9101",
      addOnItemId: 5,
    });

    expect(releaseUniplusCodigo).toHaveBeenCalledWith(1, "9101", {
      exceptAddOnItemId: 5,
    });
    expect(target.idUniplus).toBe("9101");
    expect(save).toHaveBeenCalled();
    expect(result).toEqual({
      addOnItemId: 5,
      label: "Bacon extra",
      created: false,
      removedProductId: undefined,
      clearedOptionIds: [],
    });
  });

  it("cria item novo no grupo e vincula o codigo", async () => {
    AddOnGroup.findOne.mockResolvedValue({ id: 3, companyId: 1 });
    const save = jest.fn().mockResolvedValue(undefined);
    const created = {
      id: 99,
      label: "Borda Catupiry",
      idUniplus: null,
      save,
    };
    AddOnItem.create.mockResolvedValue(created);

    const result = await LinkUniplusAddOnService({
      companyId: 1,
      codigo: "555",
      addOnGroupId: 3,
      label: "Borda Catupiry",
      value: 8.5,
    });

    expect(AddOnGroup.findOne).toHaveBeenCalledWith({
      where: { id: 3, companyId: 1 },
      attributes: ["id", "companyId"],
    });
    expect(AddOnItem.create).toHaveBeenCalledWith({
      addOnGroupId: 3,
      addOnSubgroupId: null,
      label: "Borda Catupiry",
      value: 8.5,
      order: 0,
      idUniplus: null,
    });
    expect(created.idUniplus).toBe("555");
    expect(save).toHaveBeenCalled();
    expect(result).toEqual({
      addOnItemId: 99,
      label: "Borda Catupiry",
      created: true,
      removedProductId: undefined,
      clearedOptionIds: [],
    });
  });

  it("lança erro quando o adicional não existe/não pertence a company", async () => {
    AddOnItem.findOne.mockResolvedValue(null);

    let caught: any = null;
    try {
      await LinkUniplusAddOnService({
        companyId: 1,
        codigo: "9101",
        addOnItemId: 999,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message)).toContain("ERR_UNIPLUS_ADDON_NOT_FOUND");
  });

  it("lança erro quando o grupo não existe no modo criar", async () => {
    AddOnGroup.findOne.mockResolvedValue(null);

    let caught: any = null;
    try {
      await LinkUniplusAddOnService({
        companyId: 1,
        codigo: "9101",
        addOnGroupId: 999,
        label: "Novo",
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message)).toContain("ERR_UNIPLUS_ADDON_GROUP_NOT_FOUND");
  });

  it("reatribui codigo que estava vinculado a um produto avulso (propaga removedProductId)", async () => {
    releaseUniplusCodigo.mockResolvedValue({
      clearedOptionIds: [],
      removedProductId: 77,
    });
    const save = jest.fn().mockResolvedValue(undefined);
    const target = { id: 8, label: "Borda recheada", idUniplus: null, save };
    AddOnItem.findOne.mockResolvedValue(target);

    const result = await LinkUniplusAddOnService({
      companyId: 1,
      codigo: "321",
      addOnItemId: 8,
    });

    expect(result.removedProductId).toBe(77);
    expect(target.idUniplus).toBe("321");
  });

  it("valida codigo vazio", async () => {
    let caught: any = null;
    try {
      await LinkUniplusAddOnService({
        companyId: 1,
        codigo: "",
        addOnItemId: 5,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect(String(caught.message)).toContain("ERR_UNIPLUS_ATTACH_CODIGO_REQUIRED");
  });
});
