import enum
import os

from dotenv import load_dotenv
from mysql.connector import Error as MySQLError
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from scripts.configs import PROJECT_ROOT

_source_engine: Engine | None = None

SOURCE_DB_ENV = PROJECT_ROOT / ".env.source"


class CourierName(enum.Enum):
    JNT = "JNT"
    LBCD = "LBCD"
    FEDEZ = "FEDEZ"


class RiderVehicleType(enum.Enum):
    MOTORCYCLE = "Motorcycle"
    BICYCLE = "Bicycle"
    TRICYCLE = "Tricycle"
    CAR = "Car"


def get_sqlalchemy_url() -> str:
    load_dotenv(SOURCE_DB_ENV, override=True)

    host = os.getenv("MYSQL_HOST", "127.0.0.1")
    port = os.getenv("MYSQL_PORT", "3306")
    user = os.getenv("MYSQL_USER", "root")
    password = os.getenv("MYSQL_PASSWORD", "password")
    database = os.getenv("MYSQL_DB", "faker")

    print(f"mysql+mysqlconnector://{user}:{password}@{host}:{port}/{database}")
    return f"mysql+mysqlconnector://{user}:{password}@{host}:{port}/{database}"


def get_source_engine() -> Engine:
    global _source_engine
    if _source_engine is None:
        _source_engine = create_engine(get_sqlalchemy_url(), pool_pre_ping=True)
    return _source_engine


@retry(
    reraise=True,
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
    retry=retry_if_exception_type((OperationalError, MySQLError)),
)
def ping_source() -> None:
    """Ping the source MySQL DB to verify connectivity"""
    engine = get_source_engine()
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
