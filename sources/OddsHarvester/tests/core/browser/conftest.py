from unittest.mock import AsyncMock

import pytest


@pytest.fixture
def mock_page():
    """Create a mock Playwright page for browser-helper unit tests."""
    return AsyncMock()
