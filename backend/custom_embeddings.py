import requests
from langchain.embeddings.base import Embeddings
from typing import List

class CustomEmbeddings(Embeddings):
    """A custom embedding class to interface with a specific API endpoint."""
    def __init__(self, url: str):
        super().__init__()
        self.url = url

    def _embed(self, text: str) -> List[float]:
        """Helper to embed a single text, handling API communication."""
        try:
            response = requests.post(
                self.url,
                json={"content": text},
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            # Based on llama.cpp embeddings API responses(no OpenAI, aka no v1/embeddings)
            # check the response is truely embeddings
            # [{'index': 0, 'embedding': [[0.030098535120487213, ..., -0.00043726610601879656, 0.014947145245969296]]}]
            # print("=========")
            # print(data)
            if "embedding" not in data[0]:
                raise ValueError("API response does not contain 'embedding' key")
            return data[0]["embedding"][0]
        except requests.exceptions.RequestException as e:
            print(f"Error calling embedding API: {e}")
            return []
        except (ValueError, KeyError) as e:
            print(f"Error processing API response: {e}")
            return []

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Embed a list of documents by calling the API for each."""
        # Note: For higher efficiency, a real-world implementation should support batching in the API call itself.
        return [self._embed(text) for text in texts if text.strip()]

    def embed_query(self, text: str) -> List[float]:
        """Embed a single query."""
        return self._embed(text)


if __name__ == "__main__":
    # custom_embeddings = CustomEmbeddings(url="http://localhost/embeddings")
    custom_embeddings = CustomEmbeddings(url="http://localhost/embeddings")
    embeddings = custom_embeddings.embed_query("Hello World")
    print(embeddings)
