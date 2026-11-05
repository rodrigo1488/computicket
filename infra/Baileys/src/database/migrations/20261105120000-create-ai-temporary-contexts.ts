import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AiTemporaryContexts", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      promptId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Prompts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      clearedAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      sourceMessageId: {
        type: DataTypes.STRING,
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
    await queryInterface.addIndex("AiTemporaryContexts", ["companyId", "promptId", "expiresAt"], {
      name: "ai_temporary_contexts_active"
    });
    await queryInterface.addIndex("AiTemporaryContexts", ["promptId", "sourceMessageId"], {
      name: "ai_temporary_contexts_source",
      unique: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AiTemporaryContexts");
  }
};
