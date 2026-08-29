import { Op, QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.bulkDelete("Settings", {
      key: { [Op.like]: "aiChat%" }
    });
  },

  down: async () => {
    // Sem reconstituição dos valores por empresa
  }
};
