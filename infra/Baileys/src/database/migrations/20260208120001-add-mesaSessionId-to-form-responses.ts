import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("FormResponses", "mesaSessionId", {
      type: DataTypes.STRING,
      allowNull: true,
    });
    await queryInterface.addIndex("FormResponses", ["mesaSessionId"], {
      name: "form_responses_mesa_session_id_idx",
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("FormResponses", "form_responses_mesa_session_id_idx");
    return queryInterface.removeColumn("FormResponses", "mesaSessionId");
  },
};
