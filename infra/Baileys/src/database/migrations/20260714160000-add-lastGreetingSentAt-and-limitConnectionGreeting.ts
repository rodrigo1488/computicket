import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Tickets", "lastGreetingSentAt", {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null
    });

    const now = new Date();
    await queryInterface.sequelize.query(
      `
      INSERT INTO "Settings" (key, value, "companyId", "createdAt", "updatedAt")
      SELECT
        'limitConnectionGreeting',
        'disabled',
        c.id,
        :now,
        :now
      FROM "Companies" c
      WHERE NOT EXISTS (
        SELECT 1
        FROM "Settings" s
        WHERE s.key = 'limitConnectionGreeting'
          AND s."companyId" = c.id
      )
      `,
      { replacements: { now } }
    );
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(
      `DELETE FROM "Settings" WHERE key = 'limitConnectionGreeting'`
    );
    await queryInterface.removeColumn("Tickets", "lastGreetingSentAt");
  }
};
