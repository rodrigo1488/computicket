import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === "postgres") {
      // PostgreSQL: remover constraints únicas antigas e criar novas compostas
      try {
        // Remover constraint única antiga do name se existir
        await queryInterface.sequelize.query(`
          ALTER TABLE "Queues" 
          DROP CONSTRAINT IF EXISTS "Queues_name_key";
        `);

        // Remover constraint única antiga do color se existir
        await queryInterface.sequelize.query(`
          ALTER TABLE "Queues" 
          DROP CONSTRAINT IF EXISTS "Queues_color_key";
        `);

        // Criar constraint única composta para (name, companyId)
        await queryInterface.sequelize.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS "Queues_name_companyId_unique" 
          ON "Queues" ("name", "companyId");
        `);

        // Criar constraint única composta para (color, companyId)
        await queryInterface.sequelize.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS "Queues_color_companyId_unique" 
          ON "Queues" ("color", "companyId");
        `);
      } catch (error: any) {
        // Se as constraints não existirem, apenas criar as novas
        console.warn("Algumas constraints podem não ter existido:", error.message);
        
        // Criar constraints únicas compostas
        await queryInterface.sequelize.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS "Queues_name_companyId_unique" 
          ON "Queues" ("name", "companyId");
        `);

        await queryInterface.sequelize.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS "Queues_color_companyId_unique" 
          ON "Queues" ("color", "companyId");
        `);
      }
    } else if (dialect === "mysql") {
      // MySQL: remover índices únicos antigos e criar novos compostos
      try {
        // Remover índices únicos antigos
        await queryInterface.removeIndex("Queues", "Queues_name_key");
      } catch (error) {
        // Índice pode não existir com esse nome exato
      }

      try {
        await queryInterface.removeIndex("Queues", "Queues_color_key");
      } catch (error) {
        // Índice pode não existir com esse nome exato
      }

      // Criar índices únicos compostos
      await queryInterface.addIndex("Queues", ["name", "companyId"], {
        unique: true,
        name: "Queues_name_companyId_unique"
      });

      await queryInterface.addIndex("Queues", ["color", "companyId"], {
        unique: true,
        name: "Queues_color_companyId_unique"
      });
    } else {
      // Para outros bancos, tentar remover e recriar
      try {
        // Tentar remover constraints antigas
        await queryInterface.removeConstraint("Queues", "Queues_name_key");
      } catch (error) {
        console.warn("Constraint Queues_name_key não encontrada");
      }

      try {
        await queryInterface.removeConstraint("Queues", "Queues_color_key");
      } catch (error) {
        console.warn("Constraint Queues_color_key não encontrada");
      }

      // Criar novas constraints únicas compostas
      await queryInterface.addIndex("Queues", ["name", "companyId"], {
        unique: true,
        name: "Queues_name_companyId_unique"
      });

      await queryInterface.addIndex("Queues", ["color", "companyId"], {
        unique: true,
        name: "Queues_color_companyId_unique"
      });
    }
  },

  down: async (queryInterface: QueryInterface) => {
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === "postgres") {
      // Remover constraints compostas
      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS "Queues_name_companyId_unique";
      `);

      await queryInterface.sequelize.query(`
        DROP INDEX IF EXISTS "Queues_color_companyId_unique";
      `);

      // Recriar constraints únicas simples (não recomendado, mas para reversão)
      // Nota: Isso pode falhar se houver dados duplicados
      try {
        await queryInterface.sequelize.query(`
          ALTER TABLE "Queues" 
          ADD CONSTRAINT "Queues_name_key" UNIQUE ("name");
        `);
      } catch (error) {
        console.warn("Não foi possível recriar constraint única para name:", error);
      }

      try {
        await queryInterface.sequelize.query(`
          ALTER TABLE "Queues" 
          ADD CONSTRAINT "Queues_color_key" UNIQUE ("color");
        `);
      } catch (error) {
        console.warn("Não foi possível recriar constraint única para color:", error);
      }
    } else if (dialect === "mysql") {
      // Remover índices compostos
      try {
        await queryInterface.removeIndex("Queues", "Queues_name_companyId_unique");
      } catch (error) {
        console.warn("Índice não encontrado");
      }

      try {
        await queryInterface.removeIndex("Queues", "Queues_color_companyId_unique");
      } catch (error) {
        console.warn("Índice não encontrado");
      }
    } else {
      // Para outros bancos
      try {
        await queryInterface.removeIndex("Queues", "Queues_name_companyId_unique");
      } catch (error) {
        console.warn("Índice não encontrado");
      }

      try {
        await queryInterface.removeIndex("Queues", "Queues_color_companyId_unique");
      } catch (error) {
        console.warn("Índice não encontrado");
      }
    }
  }
};
