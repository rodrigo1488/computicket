import { QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const now = new Date();
    await queryInterface.bulkInsert("Modules", [
      {
        name: "Módulo Agendamento",
        slug: "agendamento",
        description: "Agendamento online com serviços vinculados a profissionais, confirmação por WhatsApp e agenda",
        price: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.bulkDelete("Modules", { slug: "agendamento" });
  },
};
