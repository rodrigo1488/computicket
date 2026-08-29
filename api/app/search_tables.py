import psycopg2
from app.external_pg import PG_HOST, PG_DB, PG_USER, PG_PASSWORD

def search_tables():
    try:
        conn = psycopg2.connect(
            host=PG_HOST,
            database=PG_DB,
            user=PG_USER,
            password=PG_PASSWORD
        )
        cur = conn.cursor()
        print("Connected to DB.")
        
        print("\n--- Searching tables like 'dav%' ---")
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_name ILIKE 'dav%' AND table_schema = 'public'")
        rows = cur.fetchall()
        for r in rows:
            print(r[0])

        print("\n--- Searching tables like '%item%' ---")
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%item%' AND table_schema = 'public'")
        rows = cur.fetchall()
        for r in rows:
            print(r[0])
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    search_tables()
