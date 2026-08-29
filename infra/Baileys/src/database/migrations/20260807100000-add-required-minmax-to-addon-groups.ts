import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // Subgrupos: seleção obrigatória com min/max (ex.: "escolha 1 borda")
    await queryInterface.addColumn("AddOnSubgroups", "required", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn("AddOnSubgroups", "minItems", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn("AddOnSubgroups", "maxItems", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });

    // Grupo raiz (itens sem subgrupo) também pode ter regras
    await queryInterface.addColumn("AddOnGroups", "required", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn("AddOnGroups", "minItems", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn("AddOnGroups", "maxItems", {
      type: DataTypes.INTEGER,
      allowNull: true,
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("AddOnSubgroups", "required");
    await queryInterface.removeColumn("AddOnSubgroups", "minItems");
    await queryInterface.removeColumn("AddOnSubgroups", "maxItems");
    await queryInterface.removeColumn("AddOnGroups", "required");
    await queryInterface.removeColumn("AddOnGroups", "minItems");
    await queryInterface.removeColumn("AddOnGroups", "maxItems");
  },
};
