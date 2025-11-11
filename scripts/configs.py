from pathlib import Path

# ============================================================
# Project directories
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[1]

DATA_DIR = PROJECT_ROOT / "data"
SCRIPTS_DIR = PROJECT_ROOT / "scripts"

NODE_SPLITS_DIR = DATA_DIR / "node_splits"

DB_SCRIPTS_DIR = SCRIPTS_DIR / "db"

NODE_SCHEMA_FILE = DB_SCRIPTS_DIR / "node.py"
