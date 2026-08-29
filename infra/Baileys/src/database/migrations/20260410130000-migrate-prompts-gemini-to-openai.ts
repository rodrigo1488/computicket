import { QueryInterface } from "sequelize";

/**
 * Prompts que usavam Gemini passam a openai (LM Studio / OpenAI-compat).
 * Modelos gemini-* são substituídos por placeholder alinhado ao LM_STUDIO_DEFAULT_MODEL típico.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      UPDATE "Prompts"
      SET
        "provider" = 'openai',
        "model" = CASE
          WHEN "model" IS NULL OR TRIM("model") = '' THEN 'local-model'
          WHEN LOWER("model") LIKE 'gemini%' THEN 'local-model'
          ELSE "model"
        END
      WHERE LOWER(COALESCE("provider", '')) = 'gemini';
    `);
  },

  down: async () => {
    // irreversível de forma segura
  }
};
