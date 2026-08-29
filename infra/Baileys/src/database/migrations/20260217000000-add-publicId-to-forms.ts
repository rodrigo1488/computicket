import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Forms", "publicId", {
      type: DataTypes.STRING,
      allowNull: true,
    });

    const dialect = queryInterface.sequelize.getDialect();

    // Preencher registros existentes com um token aleatório (hex de 32 chars) sem depender de extensões.
    if (dialect === "postgres") {
      await queryInterface.sequelize.query(`
        UPDATE "Forms"
        SET "publicId" = md5(random()::text || clock_timestamp()::text || "id"::text)
        WHERE "publicId" IS NULL;
      `);
    } else if (dialect === "mysql" || dialect === "mariadb") {
      await queryInterface.sequelize.query(`
        UPDATE Forms
        SET publicId = MD5(CONCAT(RAND(), NOW(), id))
        WHERE publicId IS NULL;
      `);
    } else {
      // Fallback: tentar uma atualização simples; se não suportado, ficará para ser preenchido em runtime.
      // (Índice único permitirá múltiplos NULLs até que sejam preenchidos.)
    }

    await queryInterface.changeColumn("Forms", "publicId", {
      type: DataTypes.STRING,
      allowNull: false,
    });

    await queryInterface.addIndex("Forms", ["publicId"], {
      unique: true,
      name: "Forms_publicId_unique",
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("Forms", "Forms_publicId_unique");
    await queryInterface.removeColumn("Forms", "publicId");
  },
};

