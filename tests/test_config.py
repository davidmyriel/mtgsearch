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
