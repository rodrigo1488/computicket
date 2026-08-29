import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.createTable("GourmetFinanceiro", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false,
      },
      tipo: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      valor: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      dataVenda: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      mesaId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      mesaNumero: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      formResponseId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      protocol: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      entregadorUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      entregadorNome: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.dropTable("GourmetFinanceiro");
  },
};
