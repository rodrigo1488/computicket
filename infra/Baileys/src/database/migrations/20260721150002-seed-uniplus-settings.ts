import { QueryInterface } from "sequelize";

const DEFAULT_PAYMENT_MAP = JSON.stringify({
  pix: "valorpix",
  dinheiro: "valordinheiro",
  cartao: "valorcartao",
  outro: "valoroutros",
});

const KEYS: Array<{ key: string; value: string }> = [
  { key: "uniplusEnabled", value: "disabled" },
  { key: "uniplusIdFilial", value: "1" },
  { key: "uniplusIdUsuario", value: "1" },
  { key: "uniplusPaymentMap", value: DEFAULT_PAYMENT_MAP },
  { key: "uniplusPrintDeviceId", value: "" },
];

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const [companies]: any[] = await queryInterface.sequelize.query(
      `SELECT id FROM "Companies"`
    );

    const now = new Date();
    for (const company of companies || []) {
      for (const { key, value } of KEYS) {
        const [existing]: any[] = await queryInterface.sequelize.query(
          `SELECT id FROM "Settings" WHERE "companyId" = :companyId AND key = :key LIMIT 1`,
          { replacements: { companyId: company.id, key } }
        );
        if (existing?.length) continue;
        await queryInterface.bulkInsert("Settings", [
          {
            companyId: company.id,
            key,
            value,
            createdAt: now,
            updatedAt: now,
          },
        ]);
      }
    }
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(
      `DELETE FROM "Settings" WHERE key IN (:keys)`,
      {
        replacements: {
          keys: KEYS.map((k) => k.key),
        },
      }
    );
  },
};
