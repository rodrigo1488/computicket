import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
    up: (queryInterface: QueryInterface) => {
        return queryInterface.addColumn("Prompts", "businessHours", {
            type: DataTypes.JSON,
            defaultValue: null,
            allowNull: true
        });
    },

    down: (queryInterface: QueryInterface) => {
        return queryInterface.removeColumn("Prompts", "businessHours");
    }
};
