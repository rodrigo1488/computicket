import {
  isCompanyActiveForPublicAccess,
  isCompanySubscriptionExpired,
} from "../../../helpers/companyPublicAccess";

describe("companyPublicAccess helpers used by overview", () => {
  describe("isCompanyActiveForPublicAccess", () => {
    it("treats false as inactive", () => {
      expect(isCompanyActiveForPublicAccess(false)).toBe(false);
    });

    it("treats true and undefined as active", () => {
      expect(isCompanyActiveForPublicAccess(true)).toBe(true);
      expect(isCompanyActiveForPublicAccess(undefined)).toBe(true);
    });
  });

  describe("isCompanySubscriptionExpired", () => {
    it("returns false when due date is empty", () => {
      expect(isCompanySubscriptionExpired(null)).toBe(false);
    });

    it("returns true for past due dates", () => {
      expect(isCompanySubscriptionExpired("2000-01-01")).toBe(true);
    });
  });
});
