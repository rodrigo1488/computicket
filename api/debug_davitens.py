import psycopg2
from app.external_pg import PG_HOST, PG_DB, PG_USER, PG_PASSWORD

def debug_davitens():
    try:
        conn = psycopg2.connect(
            host=PG_HOST,
            database=PG_DB,
            user=PG_USER,
            password=PG_PASSWORD
        )
        cur = conn.cursor()
        print("Connected to DB.")
        
        # 1. Check exact name in information_schema
        print("\n--- Checking exact name in information_schema ---")
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_name ILIKE 'davitens' AND table_schema = 'public'")
        rows = cur.fetchall()
        for r in rows:
            print(f"Found table: '{r[0]}'")

        # 2. Try SELECT
        print("\n--- Trying SELECT FROM davitens ---")
        try:
            cur.execute("SELECT count(*) FROM davitens")
            count = cur.fetchone()[0]
            print(f"SELECT success. Count: {count}")
        except Exception as e:
            print(f"SELECT failed: {e}")
            conn.rollback()

        # 3. Try SELECT with quotes if needed (just to test)
        print("\n--- Trying SELECT FROM \"davitens\" ---")
        try:
            cur.execute("SELECT count(*) FROM \"davitens\"")
            count = cur.fetchone()[0]
            print(f"SELECT \"davitens\" success. Count: {count}")
        except Exception as e:
            print(f"SELECT \"davitens\" failed: {e}")
            conn.rollback()

        # 4. Try SELECT with uppercase (just to test)
        print("\n--- Trying SELECT FROM DAVITENS ---")
        try:
            cur.execute("SELECT count(*) FROM DAVITENS")
            count = cur.fetchone()[0]
            print(f"SELECT DAVITENS success. Count: {count}")
        except Exception as e:
            print(f"SELECT DAVITENS failed: {e}")
            conn.rollback()
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    debug_davitens()
