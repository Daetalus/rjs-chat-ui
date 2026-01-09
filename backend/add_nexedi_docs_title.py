import os
import sys
import argparse
from typing import List, Tuple

from bs4 import BeautifulSoup

from langchain_chroma import Chroma
from custom_embeddings import CustomEmbeddings


# Ensure local imports work when run as a script
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def extract_title_from_html(file_path: str) -> Tuple[str, str]:
    """Extract the <title> text and base URL from an HTML file.

    Returns a tuple of (title, url). If not found, returns ("", "").
    """
    with open(file_path, "r", encoding="utf-8") as f:
        html_content = f.read()
    soup = BeautifulSoup(html_content, "html.parser")
    title_tag = soup.find("title")
    title = title_tag.get_text().strip() if title_tag else ""
    base_tag = soup.find("base")
    url = ""
    if base_tag and base_tag.get("href"):
        url = base_tag["href"].strip()
    return title, url


def find_html_files(source_dir: str) -> List[str]:
    """List HTML files directly under the source directory."""
    return [
        os.path.join(source_dir, f)
        for f in os.listdir(source_dir)
        if f.lower().endswith(".html") and os.path.isfile(os.path.join(source_dir, f))
    ]


def index_titles(
    source_dir: str,
    persist_dir: str,
    collection_name: str,
    embed_url: str,
    batch_size: int = 50,
) -> None:
    """Read HTML files, extract titles, embed via llama.cpp HTTP endpoint, and store in Chroma.

    - Embedding endpoint is provided via `embed_url` (e.g., https://host/embeddings).
    - Stores in a Chroma collection at `persist_dir`.
    """

    os.makedirs(persist_dir, exist_ok=True)

    embeddings = CustomEmbeddings(url=embed_url)
    vector_store = Chroma(
        collection_name=collection_name,
        embedding_function=embeddings,
        persist_directory=persist_dir,
    )

    html_files = find_html_files(source_dir)
    print(f"Found {len(html_files)} HTML files in {source_dir}.")

    # Gather existing IDs to avoid duplicates on re-run
    try:
        existing_ids = set(vector_store.get()["ids"])  # type: ignore[assignment]
    except Exception:
        existing_ids = set()

    seen_ids = set()  # Deduplicate within this run

    texts: List[str] = []
    metadatas: List[dict] = []
    ids: List[str] = []

    for file_path in html_files:
        title, url = extract_title_from_html(file_path)
        if not title:
            continue
        # Use title as the stable ID
        doc_id = title
        if (doc_id in existing_ids) or (doc_id in seen_ids):
            continue
        texts.append(title)
        metadatas.append({"url": url, "source_file": os.path.basename(file_path)})
        ids.append(doc_id)
        seen_ids.add(doc_id)
        print(f"Queued: {os.path.basename(file_path)} -> '{title}' (ID: {doc_id})")

    if not texts:
        print("No new titles found to index.")
        # Print a quick verification snapshot
        try:
            total = len(vector_store.get()["ids"])  # type: ignore[index]
        except Exception:
            total = 0
        print(f"Verification: collection '{collection_name}' contains {total} documents.")
        return

    # Batch insert to the vector DB
    total = len(texts)
    total_batches = (total + batch_size - 1) // batch_size
    for i in range(0, total, batch_size):
        b_texts = texts[i : i + batch_size]
        b_metas = metadatas[i : i + batch_size]
        b_ids = ids[i : i + batch_size]
        batch_num = i // batch_size + 1
        print(f"Indexing batch {batch_num}/{total_batches} ({len(b_texts)} docs)...")
        vector_store.add_texts(texts=b_texts, metadatas=b_metas, ids=b_ids)
        print(f"Batch {batch_num} indexed.")

    # Persist index to disk
    try:
        vector_store.persist()
    except Exception:
        # LangChain Chroma persists on write; ignore if persist() is a no-op
        pass

    # Verification snapshot
    try:
        count_after = len(vector_store.get()["ids"])  # type: ignore[index]
    except Exception:
        count_after = 0
    print(f"Successfully processed {total} new titles.")
    print(f"Verification: collection '{collection_name}' now contains {count_after} documents.")


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Index HTML <title>s into a Chroma vector DB using llama.cpp embeddings.\n"
            "Provide the llama.cpp embeddings base URL via --base-url."
        )
    )
    parser.add_argument(
        "--source-dir",
        type=str,
        default=os.environ.get("TITLE_SOURCE_DIR", "./handbook_rapid_space"),
        help="Directory containing HTML files (default: ./handbook_rapid_space)",
    )
    parser.add_argument(
        "--persist-dir",
        type=str,
        default=os.environ.get("TITLE_PERSIST_DIR", "./nexedi_doc_title_vec_langchain_gemma"),
        help="Directory to persist the Chroma collection (default: ./nexedi_doc_title_vec_langchain_gemma)",
    )
    parser.add_argument(
        "--collection-name",
        type=str,
        default=os.environ.get("TITLE_COLLECTION", "nexedi_doc_titles_gemma"),
        help="Chroma collection name (default: nexedi_doc_titles_gemma)",
    )
    parser.add_argument(
        "--base-url",
        type=str,
        default=os.environ.get(
            "EMBED_BASE_URL", "http://localhost/embeddings"
        ),
        help=(
            "Base URL for llama.cpp embeddings endpoint "
            "(default: http://localhost/embeddings)"
        ),
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=int(os.environ.get("TITLE_BATCH_SIZE", "50")),
        help="Batch size for insertion into Chroma (default: 50)",
    )

    args = parser.parse_args()

    print("Configuration:")
    print(f" - source_dir:      {args.source_dir}")
    print(f" - persist_dir:     {args.persist_dir}")
    print(f" - collection_name: {args.collection_name}")
    print(f" - base_url:        {args.base_url}")
    print(f" - batch_size:      {args.batch_size}")

    index_titles(
        source_dir=args.source_dir,
        persist_dir=args.persist_dir,
        collection_name=args.collection_name,
        embed_url=args.base_url,
        batch_size=args.batch_size,
    )


if __name__ == "__main__":
    main()
