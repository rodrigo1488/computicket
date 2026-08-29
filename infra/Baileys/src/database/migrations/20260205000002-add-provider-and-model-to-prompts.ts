import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
    up: async (queryInterface: QueryInterface) => {
        try {
            await queryInterface.addColumn("Prompts", "provider", {
                type: DataTypes.TEXT,
                defaultValue: "openai",
                allowNull: false
            });
        } catch (error: any) {
            console.log("Column provider already exists or error: ", error.message);
        }
    },

    down: (queryInterface: QueryInterface) => {
        return Promise.all([
            queryInterface.removeColumn("Prompts", "provider")
        ]);
    }
};
