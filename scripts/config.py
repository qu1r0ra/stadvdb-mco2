from pathlib import Path

# ============================================================
# Project directories
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[1]

DATA_DIR = PROJECT_ROOT / "data"

NODE_SPLITS_DIR = DATA_DIR / "node_splits"
