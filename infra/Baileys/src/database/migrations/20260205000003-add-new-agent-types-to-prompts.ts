import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    // Para PostgreSQL, precisamos alterar o enum adicionando os novos valores
    // Primeiro, verificamos qual banco está sendo usado
    const dialect = queryInterface.sequelize.getDialect();
    
    if (dialect === "postgres") {
      // PostgreSQL: adicionar novos valores ao enum existente
      await queryInterface.sequelize.query(`
        DO $$ 
        BEGIN
          -- Adicionar 'atendimento' se não existir
          IF NOT EXISTS (
            SELECT 1 FROM pg_enum 
            WHERE enumlabel = 'atendimento' 
            AND enumtypid = (
              SELECT oid FROM pg_type WHERE typname = 'enum_Prompts_tipoAgente'
            )
          ) THEN
            ALTER TYPE "enum_Prompts_tipoAgente" ADD VALUE 'atendimento';
          END IF;
          
          -- Adicionar 'lanchonete' se não existir
          IF NOT EXISTS (
            SELECT 1 FROM pg_enum 
            WHERE enumlabel = 'lanchonete' 
            AND enumtypid = (
              SELECT oid FROM pg_type WHERE typname = 'enum_Prompts_tipoAgente'
            )
          ) THEN
            ALTER TYPE "enum_Prompts_tipoAgente" ADD VALUE 'lanchonete';
          END IF;
        END $$;
      `);
    } else if (dialect === "mysql") {
      // MySQL: recriar a coluna com o novo enum
      await queryInterface.changeColumn("Prompts", "tipoAgente", {
        type: DataTypes.ENUM(
          "personalizado",
          "atendente",
          "triagem",
          "recepcionista",
          "agendador",
          "atendimento",
          "lanchonete"
        ),
        allowNull: true,
        defaultValue: null
      });
    } else {
      // Para outros bancos, tentar alterar a coluna
      try {
        await queryInterface.changeColumn("Prompts", "tipoAgente", {
          type: DataTypes.ENUM(
            "personalizado",
            "atendente",
            "triagem",
            "recepcionista",
            "agendador",
            "atendimento",
            "lanchonete"
          ),
          allowNull: true,
          defaultValue: null
        });
      } catch (error) {
        console.warn("Não foi possível alterar o enum automaticamente. Execute manualmente no banco de dados.");
        console.error(error);
      }
    }
  },

  down: async (queryInterface: QueryInterface) => {
    // Reverter para o enum original (sem atendimento e lanchonete)
    const dialect = queryInterface.sequelize.getDialect();
    
    if (dialect === "postgres") {
      // PostgreSQL: não podemos remover valores de enum facilmente
      // Apenas logar um aviso
      console.warn("PostgreSQL não permite remover valores de enum. A reversão manual pode ser necessária.");
    } else if (dialect === "mysql") {
      // MySQL: recriar a coluna com o enum original
      await queryInterface.changeColumn("Prompts", "tipoAgente", {
        type: DataTypes.ENUM(
          "personalizado",
          "atendente",
          "triagem",
          "recepcionista",
          "agendador"
        ),
        allowNull: true,
        defaultValue: null
      });
    } else {
      // Para outros bancos
      try {
        await queryInterface.changeColumn("Prompts", "tipoAgente", {
          type: DataTypes.ENUM(
            "personalizado",
            "atendente",
            "triagem",
            "recepcionista",
            "agendador"
          ),
          allowNull: true,
          defaultValue: null
        });
      } catch (error) {
        console.warn("Não foi possível reverter o enum automaticamente.");
        console.error(error);
      }
    }
  }
};
