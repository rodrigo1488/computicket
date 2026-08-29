
import psycopg2

PG_HOST = "192.168.2.98"
PG_DB = "unico"
PG_USER = "postgres"
PG_PASSWORD = "postgres"

try:
    conn = psycopg2.connect(host=PG_HOST, dbname=PG_DB, user=PG_USER, password=PG_PASSWORD)
    cur = conn.cursor()
    cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'saldoestoque' ORDER BY column_name;")
    rows = cur.fetchall()
    print("Columns in 'saldoestoque' table:")
    for r in rows:
        print(f"- {r[0]} ({r[1]})")
    conn.close()
except Exception as e:
    print(f"Error: {e}")
