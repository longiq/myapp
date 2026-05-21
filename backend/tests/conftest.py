import os
import sys

# Ensure backend/ is on the path (mirrors main.py sys.path.insert)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app as fastapi_app

TEST_DB_URL = "sqlite:///./test_ci.db"

engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    import app.jlpt.models  # noqa: F401 — register all tables

    Base.metadata.create_all(bind=engine)
    fastapi_app.dependency_overrides[get_db] = override_get_db
    yield
    Base.metadata.drop_all(bind=engine)
    fastapi_app.dependency_overrides.clear()


@pytest.fixture(scope="session")
def client():
    return TestClient(fastapi_app, raise_server_exceptions=True)
