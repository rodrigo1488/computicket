import { buildAnswersMap, isFieldVisible } from "../isFieldVisible";

describe("isFieldVisible", () => {
  const parentField = { id: 10, order: 0, hasConditional: false };
  const childField = {
    id: 20,
    order: 1,
    hasConditional: true,
    conditionalFieldId: 10,
    conditionalRules: { operator: "equals", value: "Delivery" },
    isRequired: true,
  };

  it("exibe campo sem condicional", () => {
    expect(isFieldVisible(parentField, {})).toBe(true);
  });

  it("oculta campo condicional quando regra não é atendida", () => {
    const answersMap = buildAnswersMap([
      { fieldId: 10, answer: "Retirada" },
    ]);
    expect(isFieldVisible(childField, answersMap, [parentField, childField])).toBe(
      false
    );
  });

  it("exibe campo condicional quando regra é atendida", () => {
    const answersMap = buildAnswersMap([
      { fieldId: 10, answer: "delivery" },
    ]);
    expect(isFieldVisible(childField, answersMap, [parentField, childField])).toBe(
      true
    );
  });
});
