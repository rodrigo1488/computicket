import {
  isCompanyActiveForPublicAccess,
  isCompanySubscriptionExpired,
} from "../companyPublicAccess";

describe("companyPublicAccess", () => {
  describe("isCompanyActiveForPublicAccess", () => {
    it("returns true when status is true or undefined", () => {
      expect(isCompanyActiveForPublicAccess(true)).toBe(true);
      expect(isCompanyActiveForPublicAccess(undefined)).toBe(true);
    });

    it("returns false when status is false", () => {
      expect(isCompanyActiveForPublicAccess(false)).toBe(false);
    });
  });

  describe("isCompanySubscriptionExpired", () => {
    it("returns false when dueDate is empty", () => {
      expect(isCompanySubscriptionExpired(null)).toBe(false);
      expect(isCompanySubscriptionExpired(undefined)).toBe(false);
    });

    it("returns false on due date day", () => {
      const today = new Date().toISOString().slice(0, 10);
      expect(isCompanySubscriptionExpired(today)).toBe(false);
    });

    it("returns true when due date is in the past", () => {
      expect(isCompanySubscriptionExpired("2000-01-01")).toBe(true);
    });
  });
});
