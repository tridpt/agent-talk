"""Fixture dung chung cho test. Mock LLM de khong goi API that."""
import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)
