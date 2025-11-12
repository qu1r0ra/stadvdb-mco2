import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine


def get_engine(node_name: str):
    """
    Build a SQLAlchemy engine for a given node using its environment variables.
    Supports node-specific .env files (e.g., .env.node1, .env.node2, etc.).
    """
    node_env = Path(f".env.{node_name}")
    if node_env.exists():
        load_dotenv(node_env, override=True)

    host = os.getenv("MYSQL_HOST", "127.0.0.1")
    port = os.getenv("MYSQL_PORT", "3306")
    user = os.getenv("MYSQL_USER", "root")
    password = os.getenv("MYSQL_PASSWORD", "password")
    database = os.getenv("MYSQL_DB", "ridersdb")

    connection_url = (
        f"mysql+mysqlconnector://{user}:{password}@{host}:{port}/{database}"
    )
    engine = create_engine(connection_url, pool_pre_ping=True)
    return engine


def run_sql_file(engine: Engine, sql_file: str):
    """
    Execute all SQL statements from a file.
    """
    sql_path = Path(sql_file)
    if not sql_path.exists():
        raise FileNotFoundError(f"SQL file not found: {sql_file}")

    sql_text = sql_path.read_text()
    with engine.begin() as conn:
        conn.execute(text(sql_text))
    print(f"Executed SQL script: {sql_file}")


def test_connection(engine: Engine):
    """
    Simple connection test for a MySQL node.
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1;"))
        print("Connection OK.")
    except Exception as e:
        print(f"Connection failed: {e}")
