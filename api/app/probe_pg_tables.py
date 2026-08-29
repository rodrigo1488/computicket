import psycopg2
from app.external_pg import PG_HOST, PG_DB, PG_USER, PG_PASSWORD

def list_tables():
    try:
        conn = psycopg2.connect(
            host=PG_HOST,
            database=PG_DB,
            user=PG_USER,
            password=PG_PASSWORD
        )
        cur = conn.cursor()
        
        print("Connected to DB.")
        
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';")
        tables = cur.fetchall()

        print("\n--- Tables in public schema ---")
        for table in tables:
            print(table[0])
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_tables()
