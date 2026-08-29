import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) => {
    return Promise.all([
      // Adicionar appointmentId em Tasks
      queryInterface.addColumn("Tasks", "appointmentId", {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "UserAppointments",
          key: "id"
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      }),

      // Adicionar notificationSent em Tasks
      queryInterface.addColumn("Tasks", "notificationSent", {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      }),

      // Adicionar taskId em UserAppointments
      queryInterface.addColumn("UserAppointments", "taskId", {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Tasks",
          key: "id"
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      })
    ]);
  },

  down: (queryInterface: QueryInterface) => {
    return Promise.all([
      queryInterface.removeColumn("Tasks", "appointmentId"),
      queryInterface.removeColumn("Tasks", "notificationSent"),
      queryInterface.removeColumn("UserAppointments", "taskId")
    ]);
  }
};
