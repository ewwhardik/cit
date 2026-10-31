"""Shared fixtures: paths to the organiser starter pack and the official validator."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from app.dataset import Dataset

REPO = Path(__file__).resolve().parents[2]
STARTER = REPO / "starter"
DATA_PATH = STARTER / "data" / "cit_public.json"
DISRUPTION_PATH = STARTER / "examples" / "sample_disruption.json"


def load_official_validator():
    """Import starter/validator.py as a module without modifying it."""
    spec = importlib.util.spec_from_file_location("official_validator", STARTER / "validator.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="session")
def official():
    return load_official_validator()


@pytest.fixture(scope="session")
def raw_data() -> dict:
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def disruption() -> dict:
    return json.loads(DISRUPTION_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def ds(raw_data) -> Dataset:
    return Dataset(raw_data)
