import { isValidPhoneNumber, KNOWN_COUNTRY_CODES } from "../validatePhoneNumber";

describe("isValidPhoneNumber", () => {
  it("retorna true para número válido com 10-15 dígitos e código de país Brasil", () => {
    expect(isValidPhoneNumber("5511999999999")).toBe(true);
    expect(isValidPhoneNumber("5534987654321")).toBe(true);
  });

  it("retorna true para número com código de país EUA", () => {
    expect(isValidPhoneNumber("12025551234")).toBe(true);
  });

  it("retorna true para número com código de país Portugal", () => {
    expect(isValidPhoneNumber("351912345678")).toBe(true);
  });

  it("retorna false para número com menos de 10 dígitos", () => {
    expect(isValidPhoneNumber("123456789")).toBe(false);
  });

  it("retorna false para número com mais de 15 dígitos", () => {
    expect(isValidPhoneNumber("55119999999999999")).toBe(false);
  });

  it("retorna false para número sem código de país conhecido", () => {
    expect(isValidPhoneNumber("9999999999")).toBe(false);
  });

  it("retorna false para ID de grupo (muitos dígitos, sem código de país no início)", () => {
    expect(isValidPhoneNumber("120363123456789012")).toBe(false);
  });

  it("aceita número com caracteres não numéricos (remove antes de validar)", () => {
    expect(isValidPhoneNumber("55 11 99999-9999")).toBe(true);
  });

  it("retorna false para string vazia ou só caracteres não numéricos", () => {
    expect(isValidPhoneNumber("")).toBe(false);
    expect(isValidPhoneNumber("---")).toBe(false);
  });
});

describe("KNOWN_COUNTRY_CODES", () => {
  it("contém códigos de país usados na validação", () => {
    expect(KNOWN_COUNTRY_CODES).toContain("55");
    expect(KNOWN_COUNTRY_CODES).toContain("1");
    expect(KNOWN_COUNTRY_CODES).toContain("351");
  });
});
