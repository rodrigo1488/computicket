import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.createTable("FormFields", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      formId: {
        type: DataTypes.INTEGER,
        references: { model: "Forms", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      label: {
        type: DataTypes.STRING,
        allowNull: false
      },
      fieldType: {
        type: DataTypes.STRING,
        allowNull: false
      },
      placeholder: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      isRequired: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      options: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      helpText: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      validation: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      hasConditional: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      conditionalRules: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      conditionalFieldId: {
        type: DataTypes.INTEGER,
        allowNull: true
      },
      metadata: {
        type: DataTypes.JSONB,
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
    return queryInterface.dropTable("FormFields");
  }
};
