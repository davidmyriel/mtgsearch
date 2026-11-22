import importlib

from mtgsearch import config


def test_empty_environment_variables_fall_back_to_defaults(monkeypatch):
    # GitHub Actions passes unset repository variables as empty strings.
    for name in ("MTGSEARCH_COLLECTION", "TOPK_REGION", "MTGSEARCH_DATA_DIR"):
        monkeypatch.setenv(name, "")
    reloaded = importlib.reload(config)
    assert reloaded.COLLECTION == "mtg-cards-v2"
    assert reloaded.REGION == "aws-us-east-1-elastica"
    assert str(reloaded.DATA_DIR) == "data"


def test_environment_variables_override_defaults(monkeypatch):
    monkeypatch.setenv("MTGSEARCH_COLLECTION", "mtg-cards-v9")
    assert importlib.reload(config).COLLECTION == "mtg-cards-v9"
    monkeypatch.delenv("MTGSEARCH_COLLECTION")
    importlib.reload(config)


def test_api_key_is_stripped_of_stray_whitespace(monkeypatch):
    seen = {}

    def fake_client(api_key, region):
        seen.update(api_key=api_key, region=region)

    monkeypatch.setattr("topk_sdk.Client", fake_client)
    monkeypatch.setenv("TOPK_API_KEY", "  abc123\r\n")
    importlib.reload(config).client()
    assert seen["api_key"] == "abc123"


def test_missing_api_key_is_a_clear_error(monkeypatch):
    import pytest

    monkeypatch.setenv("TOPK_API_KEY", " \n")
    with pytest.raises(SystemExit, match="TOPK_API_KEY is not set"):
        importlib.reload(config).client()
