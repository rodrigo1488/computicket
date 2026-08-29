import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface.createTable("ResponseAnswers", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      responseId: {
        type: DataTypes.INTEGER,
        references: { model: "FormResponses", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      fieldId: {
        type: DataTypes.INTEGER,
        references: { model: "FormFields", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      answer: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      answerData: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      fileUrl: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.dropTable("ResponseAnswers");
  }
};
