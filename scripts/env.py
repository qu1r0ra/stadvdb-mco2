import os

from dotenv import load_dotenv


def load_env():
    load_dotenv()
    env = {
        "node1": {
            "host": os.getenv("NODE1_HOST"),
            "port": os.getenv("NODE1_PORT"),
            "db": os.getenv("NODE1_DB"),
            "user": os.getenv("NODE1_USER"),
            "password": os.getenv("NODE1_PASSWORD"),
        },
        "node2": {
            "host": os.getenv("NODE2_HOST"),
            "port": os.getenv("NODE2_PORT"),
            "db": os.getenv("NODE2_DB"),
            "user": os.getenv("NODE2_USER"),
            "password": os.getenv("NODE2_PASSWORD"),
        },
        "node3": {
            "host": os.getenv("NODE3_HOST"),
            "port": os.getenv("NODE3_PORT"),
            "db": os.getenv("NODE3_DB"),
            "user": os.getenv("NODE3_USER"),
            "password": os.getenv("NODE3_PASSWORD"),
        },
    }
    return env
