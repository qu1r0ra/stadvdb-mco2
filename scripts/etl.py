import os

import pandas as pd

from scripts.configs import NODE_SPLITS_DIR
from scripts.db.source import get_source_engine


def extract_riders_data() -> pd.DataFrame:
    engine = get_source_engine()
    query = """
    SELECT
        c.name AS courierName,
        r.vehicleType,
        r.firstName,
        r.lastName,
        r.gender,
        r.age,
        r.createdAt,
        r.updatedAt
    FROM Riders r
    JOIN Couriers c ON r.courierId = c.id;
    """
    riders_df = pd.read_sql(query, engine)
    return riders_df


def transform_riders_data(riders_df: pd.DataFrame) -> pd.DataFrame:
    new_df = riders_df.copy()

    new_df["vehicleType"] = (
        new_df["vehicleType"]
        .str.strip()
        .str.lower()
        .replace({"motorbike": "motorcycle", "bike": "bicycle", "trike": "tricycle"})
        .str.title()
    )
    new_df["gender"] = (
        new_df["gender"]
        .str.strip()
        .str.lower()
        .replace({"m": "male", "f": "female"})
        .str.title()
    )
    new_df["createdAt"] = pd.to_datetime(new_df["createdAt"], errors="coerce")
    new_df["updatedAt"] = pd.to_datetime(new_df["updatedAt"], errors="coerce")

    return new_df


def save_riders_data(riders_df: pd.DataFrame):
    os.makedirs(NODE_SPLITS_DIR, exist_ok=True)
    riders_df.to_csv(NODE_SPLITS_DIR / "node1_full.csv", index=False)
    riders_df[riders_df["courierName"] == "JNT"].to_csv(
        NODE_SPLITS_DIR / "node2_fragment.csv", index=False
    )
    riders_df[riders_df["courierName"] != "JNT"].to_csv(
        NODE_SPLITS_DIR / "node3_fragment.csv", index=False
    )


def main():
    riders_df = extract_riders_data()
    transformed_riders_df = transform_riders_data(riders_df)
    save_riders_data(transformed_riders_df)


if __name__ == "__main__":
    main()
