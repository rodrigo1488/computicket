import "../bootstrap";

/**
 * Sequelize CLI (db:migrate) usa este arquivo. Erro "unknown timed out" = não conseguiu
 * abrir TCP com o banco. Confira: serviço MySQL/Postgres rodando, DB_HOST, DB_PORT,
 * firewall. No Windows: Test-NetConnection DB_HOST -Port DB_PORT
 */
const dialect = process.env.DB_DIALECT || "mysql";

if (!process.env.DB_HOST) {
  console.error(
    "[database] DB_HOST não está definido no .env — defina DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS."
  );
}

// Timeout de conexão no driver (evita espera genérica do retry-as-promised)
const dialectOptions: Record<string, unknown> = {};
if (dialect === "mysql") {
  // mysql2: falha em ~10s com erro mais explícito se host não responde
  dialectOptions.connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT) || 10000;
} else if (dialect === "postgres") {
  dialectOptions.connectTimeoutMillis =
    Number(process.env.DB_CONNECT_TIMEOUT) || 10000;
}

module.exports = {
  define: {
    charset: "utf8mb4",
    collate: "utf8mb4_bin",
  },
  dialect,
  timezone: "-03:00",
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  dialectOptions:
    Object.keys(dialectOptions).length > 0 ? dialectOptions : undefined,
  logging: process.env.DB_DEBUG === "true" 
    ? (msg) => console.log(`[Sequelize] ${new Date().toISOString()}: ${msg}`) 
    : false,
  pool: {
    max: 20,
    min: 1,
    // 0 = sem limite no acquire; valor explícito evita hang em alguns ambientes
    acquire: Number(process.env.DB_POOL_ACQUIRE) || 60000,
    idle: 30000,
    evict: 1000 * 60 * 5,
  },
  retry: {
    max: 3,
    timeout: 30000,
    match: [
      /Deadlock/i,
      /SequelizeConnectionError/,
      /SequelizeConnectionRefusedError/,
      /SequelizeConnectionTimedOutError/,
      /SequelizeHostNotFoundError/,
      /SequelizeHostNotReachableError/,
      /SequelizeInvalidConnectionError/,
      /SequelizeConnectionAcquireTimeoutError/,
      /Operation timeout/,
      /ETIMEDOUT/
    ]
  },
};
