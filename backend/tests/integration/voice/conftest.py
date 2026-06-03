"""Integration-test fixtures for the voice provider.

The top-level tests/conftest.py installs a session-wide stub that replaces
google.auth.default() with fake credentials so unit tests can construct
google-cloud-* clients without ADC. That's exactly wrong for integration
tests that need to hit real GCP APIs.

This fixture restores the real implementation for voice integration tests
only, by patching the mock target back to the original. autouse=True so
every test in tests/integration/voice/ gets it without per-test opt-in.
"""

from unittest import mock

import google.auth
import pytest


@pytest.fixture(autouse=True)
def _restore_real_google_auth():
    """Restore the real google.auth.default() for voice integration tests.

    The session-wide stub in tests/conftest.py replaces this function with
    one that returns fake credentials. Real GCP calls then fail with
    "Method doesn't allow unregistered callers". This fixture undoes that
    for the duration of each integration test.
    """
    # Stop any patch currently active on google.auth.default and call the
    # real one. mock.patch.stopall() is too aggressive (would stop every
    # patch in the session); instead, we directly patch back to the
    # un-mocked function by importing the real google.auth.default via
    # google.auth._default (the underlying impl), bypassing the session
    # mock.
    from google.auth import _default as real_default

    with mock.patch.object(google.auth, "default", real_default.default):
        yield
