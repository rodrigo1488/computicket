import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.createTable("CustomProposals", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      company: {
        type: DataTypes.STRING,
        allowNull: false
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: false
      },
      users: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      collaborators: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      features: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: []
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      planId: {
        type: DataTypes.INTEGER,
        references: { model: "Plans", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.dropTable("CustomProposals");
  }
};
