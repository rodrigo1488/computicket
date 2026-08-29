const { Client } = require("pg");
const { hash } = require("bcryptjs");

async function main() {
  const c = new Client({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 1861),
    user: process.env.DB_USER || "compumais",
    password: process.env.DB_PASS || "compumais",
    database: process.env.DB_NAME || "compumais",
  });
  await c.connect();
  const existing = await c.query('SELECT id, email FROM "Users" WHERE email = $1', [
    "admin@admin.com",
  ]);
  if (existing.rowCount) {
    console.log("admin already exists", existing.rows[0].id);
    await c.end();
    return;
  }
  const companies = await c.query('SELECT id, name FROM "Companies" ORDER BY id ASC LIMIT 1');
  if (!companies.rowCount) {
    throw new Error("Nenhuma empresa no Postgres do engine — rode as seeds.");
  }
  const companyId = companies.rows[0].id;
  const passwordHash = await hash("123456", 8);
  const inserted = await c.query(
    `INSERT INTO "Users"
      (name, email, "passwordHash", profile, "companyId", super, active, "allTicket", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,true,true,'enabled', NOW(), NOW())
     RETURNING id`,
    ["Computicket Admin", "admin@admin.com", passwordHash, "admin", companyId],
  );
  console.log("admin created", inserted.rows[0].id, "company", companyId, companies.rows[0].name);
  await c.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
