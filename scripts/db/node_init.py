import pandas as pd
from sqlalchemy import text

from scripts.configs import DB_SCRIPTS_DIR, NODE_NAMES, NODE_SPLITS_DIR
from scripts.db.utils import get_engine

SCHEMA_FILE = DB_SCRIPTS_DIR / "schema.sql"


def init_node(node_name: str):
    """Initialize a MySQL node by creating schema and loading data."""
    print(f"Initializing {node_name}...")

    engine = get_engine(node_name)
    sql_text = SCHEMA_FILE.read_text()

    # Create schema
    with engine.begin() as conn:
        conn.execute(text(sql_text))
        print(f"Schema created for {node_name}")

    # Load CSV data
    csv_path = NODE_SPLITS_DIR / f"{node_name}.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"Missing data file: {csv_path}")

    df = pd.read_csv(csv_path)
    df.to_sql("Riders", con=engine, index=False)
    print(f"Data loaded for {node_name} ({len(df)} rows)")


def reset_node(node_name: str):
    """Drop and recreate schema for a clean state."""
    engine = get_engine(node_name)
    with engine.begin() as conn:
        conn.execute(text("DROP DATABASE IF EXISTS ridersdb;"))
    init_node(node_name)


def verify_node(node_name: str):
    """Check that node data and schema are correct."""
    engine = get_engine(node_name)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT COUNT(*) FROM Riders;")).scalar()
        print(f"{node_name} → {result} rows in Riders table")


def main():
    for node in NODE_NAMES:
        init_node(node)
        verify_node(node)


if __name__ == "__main__":
    print("Running script!")
    # main()
