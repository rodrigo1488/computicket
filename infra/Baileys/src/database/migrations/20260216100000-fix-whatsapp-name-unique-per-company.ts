import { QueryInterface } from "sequelize";

/**
 * Multi-tenant: nome da conexão (Whatsapp) deve ser único por empresa, não global.
 * Remove UNIQUE(name) e cria UNIQUE(companyId, name).
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === "postgres") {
      // Remover constraint/index único antigo em "name" (pode ser constraint ou unique index)
      try {
        await queryInterface.sequelize.query(`
          ALTER TABLE "Whatsapps"
          DROP CONSTRAINT IF EXISTS "Whatsapps_name_key";
        `);
      } catch (e: any) {
        // Pode ser um índice em vez de constraint
        try {
          await queryInterface.removeIndex("Whatsapps", "Whatsapps_name_key");
        } catch (e2: any) {
          console.warn("Whatsapps_name_key não encontrado (pode já ter sido removido):", e2?.message);
        }
      }

      try {
        await queryInterface.sequelize.query(`
          DROP INDEX IF EXISTS "Whatsapps_name_key";
        `);
      } catch (e: any) {
        console.warn("Drop index Whatsapps_name_key:", e?.message);
      }

      // Criar índice único composto (companyId, name)
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "Whatsapps_companyId_name_unique"
        ON "Whatsapps" ("companyId", "name");
      `);
    } else if (dialect === "mysql") {
      try {
        await queryInterface.removeIndex("Whatsapps", "name");
      } catch (e: any) {
        try {
          await queryInterface.removeIndex("Whatsapps", "Whatsapps_name_key");
        } catch (e2: any) {
          console.warn("Índice único antigo em name não encontrado:", e2?.message);
        }
      }

      await queryInterface.addIndex("Whatsapps", ["companyId", "name"], {
        unique: true,
        name: "Whatsapps_companyId_name_unique"
      });
    } else {
      try {
        await queryInterface.removeConstraint("Whatsapps", "Whatsapps_name_key");
      } catch (e: any) {
        console.warn("Constraint Whatsapps_name_key não encontrada");
      }
      await queryInterface.addIndex("Whatsapps", ["companyId", "name"], {
        unique: true,
        name: "Whatsapps_companyId_name_unique"
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === "postgres") {
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS "Whatsapps_companyId_name_unique";
      `);
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "Whatsapps_name_key" ON "Whatsapps" ("name");
      `);
    } else if (dialect === "mysql") {
      await queryInterface.removeIndex("Whatsapps", "Whatsapps_companyId_name_unique");
      await queryInterface.addIndex("Whatsapps", ["name"], {
        unique: true,
        name: "Whatsapps_name_key"
      });
    } else {
      await queryInterface.removeIndex("Whatsapps", "Whatsapps_companyId_name_unique");
      await queryInterface.addIndex("Whatsapps", ["name"], {
        unique: true,
        name: "Whatsapps_name_key"
      });
    }
  }
};
