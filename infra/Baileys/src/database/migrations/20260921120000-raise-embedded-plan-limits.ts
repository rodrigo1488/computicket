import { QueryInterface } from "sequelize";

const EMBEDDED_LIMIT = 9999;

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(
      `UPDATE "Plans"
       SET users = :limit, connections = :limit, queues = :limit, "updatedAt" = NOW()
       WHERE users < :limit OR connections < :limit OR queues < :limit`,
      { replacements: { limit: EMBEDDED_LIMIT } }
    );
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(
      `UPDATE "Plans"
       SET users = 10, connections = 10, queues = 10, "updatedAt" = NOW()
       WHERE users = :limit AND connections = :limit AND queues = :limit`,
      { replacements: { limit: EMBEDDED_LIMIT } }
    );
  }
};
