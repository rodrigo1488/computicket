import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return queryInterface
      .createTable("AppointmentServices", {
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
        userId: {
          type: DataTypes.INTEGER,
          references: { model: "Users", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE",
          allowNull: false,
        },
        name: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        durationMinutes: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        value: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: true,
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        isActive: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        displayOrder: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
        },
        createdAt: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        updatedAt: {
          type: DataTypes.DATE,
          allowNull: false,
        },
      })
      .then(() =>
        Promise.all([
          queryInterface.addIndex("AppointmentServices", ["companyId"], {
            name: "idx_appointment_services_company_id",
          }),
          queryInterface.addIndex("AppointmentServices", ["userId"], {
            name: "idx_appointment_services_user_id",
          }),
        ])
      );
  },

  down: (queryInterface: QueryInterface) => {
    return queryInterface.dropTable("AppointmentServices");
  },
};
