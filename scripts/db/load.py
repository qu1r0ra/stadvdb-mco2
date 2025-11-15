import pandas as pd

from scripts.db.utils import connect_db
from pathlib import Path


def load_csv_to_node(csv_path: Path, connection):
    df = pd.read_csv(csv_path)
    cursor = connection.cursor()

    insert_sql = """
        INSERT INTO Riders
            (courierName, vehicleType, firstName, lastName, gender, age,
            createdAt, updatedAt)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """

    for _, row in df.iterrows():
        cursor.execute(
            insert_sql,
            (
                row["courierName"],
                row["vehicleType"],
                row["firstName"],
                row["lastName"],
                row["gender"],
                None if pd.isna(row["age"]) else int(row["age"]),
                row["createdAt"],
                row["updatedAt"],
            ),
        )

    cursor.close()
    print(f"[INFO] Loaded {len(df)} rows → {csv_path}")


def connect_all_nodes(env):
    n1 = connect_db(
        env["node1"]["host"],
        env["node1"]["port"],
        env["node1"]["user"],
        env["node1"]["password"],
        env["node1"]["db"],
    )
    n2 = connect_db(
        env["node2"]["host"],
        env["node2"]["port"],
        env["node2"]["user"],
        env["node2"]["password"],
        env["node2"]["db"],
    )
    n3 = connect_db(
        env["node3"]["host"],
        env["node3"]["port"],
        env["node3"]["user"],
        env["node3"]["password"],
        env["node3"]["db"],
    )

    return {"node1": n1, "node2": n2, "node3": n3}
