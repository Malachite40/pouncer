import sys
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

# Ensure the app package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def make_soup():
    """Create a BeautifulSoup object from an HTML string."""
    def _make(html: str) -> BeautifulSoup:
        return BeautifulSoup(html, "lxml")
    return _make


@pytest.fixture
def load_fixture():
    """Load an HTML fixture file from the fixtures directory."""
    fixtures_dir = Path(__file__).parent / "fixtures"

    def _load(name: str) -> str:
        return (fixtures_dir / name).read_text(encoding="utf-8")
    return _load
