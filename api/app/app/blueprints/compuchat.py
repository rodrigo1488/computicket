from flask import jsonify, Blueprint

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    psycopg2 = None
    RealDictCursor = None


bp = Blueprint("compuchat", __name__)

def get_db_connection():
    if psycopg2 is None:
        raise RuntimeError("psycopg2 não está instalado neste ambiente")
    conn = psycopg2.connect(
        dbname="compumais",
        user="compuchat",
        password="compumais",
        host="72.61.54.80",  # Assuming local, adjust if needed
        port="5432"  # Default PostgreSQL port
    )
    return conn






@bp.route('/api/pending_tickets')
def pending_tickets():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query = """
        SELECT
          t.status,
          t."contactId",
          t."lastMessage",
          c.name      AS contact_name,
          c.number    AS contact_number,
          t."createdAt",
          t."queueId",
          q.name      AS queue_name
        FROM "Tickets" t
        LEFT JOIN "Contacts" c ON c.id = t."contactId"
        LEFT JOIN "Queues"   q ON q.id = t."queueId"
        WHERE t.status = 'pending'
          AND t."whatsappId" = 7
        ORDER BY t."createdAt" DESC;
        """
        cursor.execute(query)
        results = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify(results)
    except Exception as e:
        print(f"Erro ao buscar tickets: {e}")
        return jsonify({"error": str(e)}), 500

