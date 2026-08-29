import { QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const now = new Date();
    await queryInterface.bulkInsert("Modules", [
      {
        name: "Módulo Lanchonetes",
        slug: "lanchonetes",
        description: "Cardápio digital, produtos e pedidos via WhatsApp",
        price: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // Migrar dados da Setting companyModules para CompanyModules
    const [settingsRows] = await queryInterface.sequelize.query(
      `SELECT id, "companyId", value FROM "Settings" WHERE key = 'companyModules'`
    );
    const settings = Array.isArray(settingsRows) ? settingsRows : [];

    if (settings.length > 0) {
      const [modulesRows] = await queryInterface.sequelize.query(
        `SELECT id, slug FROM "Modules"`
      );
      const modules = Array.isArray(modulesRows) ? modulesRows : [];
      const moduleMap = Object.fromEntries(
        modules.map((m: any) => [m.slug, m.id])
      );

      const companyModulesToInsert: any[] = [];
      for (const s of settings) {
        try {
          const arr = JSON.parse(s.value || "[]");
          if (Array.isArray(arr)) {
            for (const slug of arr) {
              const moduleId = moduleMap[slug];
              if (moduleId) {
                companyModulesToInsert.push({
                  companyId: s.companyId,
                  moduleId,
                  createdAt: now,
                  updatedAt: now,
                });
              }
            }
          }
        } catch (_) {}
      }

      if (companyModulesToInsert.length > 0) {
        await queryInterface.bulkInsert("CompanyModules", companyModulesToInsert);
      }
    }
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.bulkDelete("CompanyModules", {});
    await queryInterface.bulkDelete("Modules", { slug: "lanchonetes" });
  },
};
