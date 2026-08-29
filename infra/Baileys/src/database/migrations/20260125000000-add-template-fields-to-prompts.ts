import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.addColumn("Prompts", "tipoAgente", {
        type: DataTypes.ENUM("personalizado", "atendente", "triagem", "recepcionista", "agendador"),
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Prompts", "isTemplate", {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
      }),
      queryInterface.addColumn("Prompts", "templateVariables", {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "JSON com variáveis do template (nome_agente, tom_resposta, observacoes, etc)"
      })
    ]);
  },

  down: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.removeColumn("Prompts", "tipoAgente"),
      queryInterface.removeColumn("Prompts", "isTemplate"),
      queryInterface.removeColumn("Prompts", "templateVariables")
    ]);
  }
};
