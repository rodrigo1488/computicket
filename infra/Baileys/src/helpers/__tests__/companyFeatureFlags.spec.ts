jest.mock("../../models/Setting", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findAll: jest.fn() }
}));

import Setting from "../../models/Setting";
import {
  AUTO_CLOSE_SETTING,
  SECTOR_MENU_SETTING,
  isAutoCloseEnabled,
  isSectorMenuEnabled
} from "../companyFeatureFlags";

const findOne = Setting.findOne as jest.Mock;

describe("leitura dos interruptores no engine", () => {
  beforeEach(() => {
    findOne.mockReset();
  });

  it("encerramento automático desligado impede o cron", async () => {
    findOne.mockResolvedValue({ value: "disabled" });
    await expect(isAutoCloseEnabled(7)).resolves.toBe(false);
    expect(findOne).toHaveBeenCalledWith({
      where: { companyId: 7, key: AUTO_CLOSE_SETTING }
    });
  });

  it("menu de setor ausente permanece ligado", async () => {
    findOne.mockResolvedValue(null);
    await expect(isSectorMenuEnabled(7)).resolves.toBe(true);
    expect(findOne).toHaveBeenCalledWith({
      where: { companyId: 7, key: SECTOR_MENU_SETTING }
    });
  });

  it("menu de setor desligado não dispara saudação", async () => {
    findOne.mockResolvedValue({ value: "disabled" });
    await expect(isSectorMenuEnabled(7)).resolves.toBe(false);
  });
});
