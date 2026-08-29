from app import create_app, db
from sqlalchemy import text

def main():
	app = create_app()
	with app.app_context():
		engine = db.session.bind
		print(f"Engine: {engine}")
		print(f"Dialect: {engine.dialect.name if engine else 'unknown'}")
		try:
			# Tentar identificar arquivo do SQLite
			url = str(engine.url) if engine else ''
			print(f"URL: {url}")
		except Exception as e:
			print(f"URL error: {e}")

		if engine and engine.dialect.name == 'sqlite':
			cols = db.session.execute(text("PRAGMA table_info('plan')")).fetchall()
			col_names = [c[1] for c in cols]
			print("Colunas atuais em 'plan':", col_names)
			if 'support_included' not in col_names:
				print("Adicionando coluna 'support_included'...")
				db.session.execute(text("ALTER TABLE plan ADD COLUMN support_included BOOLEAN DEFAULT 0"))
				db.session.commit()
				cols2 = db.session.execute(text("PRAGMA table_info('plan')")).fetchall()
				print("Após ALTER, colunas:", [c[1] for c in cols2])
				print("✅ support_included criada com sucesso")
			else:
				print("✅ support_included já existe")
		else:
			print("Banco não é SQLite; use migração Alembic.")

if __name__ == '__main__':
	main()



