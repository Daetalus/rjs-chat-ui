import types
from typing import Any, Dict, List

import requests

from custom_embeddings import CustomEmbeddings


BASE_URL = "http://localhost/v1/embeddings"


class DummyResponse:
    def __init__(self, status_code: int = 200, json_data: Dict[str, Any] | None = None):
        self.status_code = status_code
        self._json_data = json_data or {}

    def json(self) -> Dict[str, Any]:
        return self._json_data

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


def test_custom_embeddings_query_and_documents(monkeypatch):
    calls: List[Dict[str, Any]] = []

    def fake_post(url: str, json: Dict[str, Any], timeout: int = 30):  # noqa: A002  (shadowing built-in json)
        calls.append({"url": url, "json": json, "timeout": timeout})
        return DummyResponse(status_code=200, json_data={"embedding": [1.0, 2.0, 3.0]})

    monkeypatch.setattr(requests, "post", fake_post)

    emb = CustomEmbeddings(model="embeddinggemma-300M-BF16.gguf", url=BASE_URL)

    # Single query
    v = emb.embed_query("hello world")
    assert isinstance(v, list) and v == [1.0, 2.0, 3.0]

    # Multiple documents
    docs = ["alpha", "beta"]
    vs = emb.embed_documents(docs)
    assert isinstance(vs, list) and len(vs) == 2
    for vec in vs:
        assert vec == [1.0, 2.0, 3.0]

    # Verify requests made
    assert len(calls) == 1 + len(docs)  # one for query, one per document
    # Check payload and URL of first call
    assert calls[0]["url"] == BASE_URL
    assert calls[0]["json"]["model"] == "embeddinggemma-300M-BF16.gguf"
    assert "prompt" in calls[0]["json"]


def test_custom_embeddings_handles_missing_key(monkeypatch):
    def fake_post(url: str, json: Dict[str, Any], timeout: int = 30):  # noqa: A002
        return DummyResponse(status_code=200, json_data={"not_embedding": [0.0]})

    monkeypatch.setattr(requests, "post", fake_post)

    emb = CustomEmbeddings(model="embeddinggemma-300M-BF16.gguf", url=BASE_URL)
    # When the API does not return 'embedding', we expect an empty vector per implementation
    assert emb.embed_query("oops") == []

