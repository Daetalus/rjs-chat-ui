import os
import sys
import argparse
import hashlib
import json
import re
from typing import List, Dict, Tuple

from bs4 import BeautifulSoup
from markdownify import markdownify as md

# LangChain + Chroma vector store
from langchain_chroma import Chroma
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.schema import Document as LCDocument

from custom_embeddings import CustomEmbeddings


# Add backend to sys.path (if run from scripts)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def calculate_file_hash(file_path: str) -> str:
    """Calculate SHA256 for a file's content."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            hasher.update(chunk)
    return hasher.hexdigest()


def parse_html_to_markdown(html_content: str) -> Tuple[str, str, str]:
    """Extract base URL, <title>, and convert HTML to Markdown string.

    Returns (markdown, url, title).
    """
    soup = BeautifulSoup(html_content, "html.parser")
    title_tag = soup.find("title")
    title = title_tag.get_text().strip() if title_tag else ""
    base_tag = soup.find("base")
    url = base_tag["href"].strip() if base_tag and base_tag.get("href") else ""

    # Remove script/style for cleaner text
    for tag in soup(["script", "style"]):
        tag.decompose()

    # Drop embedded images (data URIs) which we don't handle in RAG
    for img in soup.find_all("img", src=True):
        src = (img.get("src") or "").strip()
        if src.lower().startswith("data:"):
            img.decompose()

    markdown_content = md(str(soup), heading_style="ATX")
    return markdown_content, url, title


def clean_text(text: str) -> str:
    """Light cleaning to remove extra whitespace and empty lines."""
    # Normalize Windows line-endings to UNIX
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse more than 2 blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Trim trailing spaces on lines
    text = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)
    return text.strip()


def determine_chunk_type(content: str) -> str:
    content_lower = content.lower()
    if "```" in content or re.search(r"\n    \w", content):
        return "code"
    if any(word in content_lower for word in ["install", "setup", "configure", "step"]):
        return "instructions"
    if re.search(r"^\s*(\d+\.|[-*+])\s+", content, re.MULTILINE):
        return "list"
    if any(word in content_lower for word in ["error", "troubleshoot", "problem", "issue"]):
        return "troubleshooting"
    if content.count("#") > 0:
        return "section"
    return "content"


class NexediDocIndexerLangChain:
    """Index HTML docs to Chroma using LangChain + llama.cpp embeddings."""

    def __init__(
        self,
        source_dir: str,
        persist_dir: str,
        collection_name: str,
        embed_base_url: str,
        log_file_dir: str | None = None,
    ) -> None:
        self.source_dir = source_dir
        self.persist_dir = persist_dir
        self.collection_name = collection_name
        self.embed_url = embed_base_url.rstrip("/") + "/v1/embeddings"
        self.log_file_dir = log_file_dir or self.source_dir
        os.makedirs(self.log_file_dir, exist_ok=True)
        os.makedirs(self.persist_dir, exist_ok=True)

        self.embeddings = CustomEmbeddings(url=self.embed_url)
        self.vector_store = Chroma(
            collection_name=self.collection_name,
            embedding_function=self.embeddings,
            persist_directory=self.persist_dir,
        )

        # Text splitter similar in spirit to the haystack splitter
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            separators=["\n\n", "\n", ". ", " ", ""],
        )

        self._processed_index = os.path.join(self.log_file_dir, "processed_files.json")

    def _load_processed(self) -> Dict[str, str]:
        try:
            with open(self._processed_index, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_processed(self, mapping: Dict[str, str]) -> None:
        with open(self._processed_index, "w", encoding="utf-8") as f:
            json.dump(mapping, f, ensure_ascii=False, indent=2)

    def _delete_previous_chunks(self, file_path: str) -> None:
        try:
            # Delete by metadata filter
            self.vector_store.delete(where={"source": os.path.abspath(file_path)})
        except Exception:
            # Fallback: ignore if not supported
            pass

    def load_and_index_docs(self) -> None:
        html_files = [f for f in os.listdir(self.source_dir) if f.lower().endswith(".html")]
        print(f"Found {len(html_files)} HTML files in {self.source_dir}.")

        processed = self._load_processed()
        added_files: List[str] = []

        texts: List[str] = []
        metadatas: List[dict] = []
        ids: List[str] = []

        # Track existing IDs for idempotency and a per-run set to avoid duplicates in-batch
        try:
            existing_ids = set(self.vector_store.get()["ids"])  # type: ignore[assignment]
        except Exception:
            existing_ids = set()
        seen_ids = set()

        for file_name in html_files:
            file_path = os.path.join(self.source_dir, file_name)
            with open(file_path, "r", encoding="utf-8") as f:
                html_content = f.read()

            file_hash = calculate_file_hash(file_path)
            prev_hash = processed.get(file_name)
            if prev_hash == file_hash:
                continue  # unchanged

            # Changed or new: remove previous chunks, then re-index
            if prev_hash is not None and prev_hash != file_hash:
                self._delete_previous_chunks(file_path)
                # Refresh existing IDs after deletion (so we can re-add freshly)
                try:
                    existing_ids = set(self.vector_store.get()["ids"])  # type: ignore[assignment]
                except Exception:
                    existing_ids = set()

            markdown_content, url, title = parse_html_to_markdown(html_content)
            markdown_content = clean_text(markdown_content)
            print("************************")
            print(markdown_content)

            # Split into chunks
            chunks = self.splitter.split_text(markdown_content)
            total_chunks = len(chunks)
            doc_name = os.path.splitext(file_name)[0]

            for i, chunk in enumerate(chunks):
                if not chunk.strip():
                    continue
                chunk_meta = {
                    "doc_name": doc_name,
                    "url": url,
                    "source": os.path.abspath(file_path),
                    "file_hash": file_hash,
                    "chunk_id": i,
                    "total_chunks": total_chunks,
                    "chunk_type": determine_chunk_type(chunk),
                }
                # Use title as base ID (fallback to doc_name); ensure uniqueness per chunk
                base_id = title or doc_name
                doc_id = f"{base_id}:{i}"
                if (doc_id in existing_ids) or (doc_id in seen_ids):
                    continue
                texts.append(chunk)
                metadatas.append(chunk_meta)
                ids.append(doc_id)
                seen_ids.add(doc_id)

            processed[file_name] = file_hash
            added_files.append(file_name)
            print(f"Prepared {file_name} ({total_chunks} chunks) for indexing.")

        if not texts:
            print("No new documents to index.")
            print("\nNo new files were added to the index.")
            return

        # Insert in batches for better progress feedback
        batch_size = 1
        total = len(texts)
        total_batches = (total + batch_size - 1) // batch_size
        for i in range(0, total, batch_size):
            bt = texts[i : i + batch_size]
            bm = metadatas[i : i + batch_size]
            bi = ids[i : i + batch_size]
            batch_num = i // batch_size + 1
            print(f"Indexing batch {batch_num}/{total_batches} ({len(bt)} chunks)...")
            print("Texts: ===========")
            print(bt)
            print("*****************")
            print(bm)
            print("*****************")
            print(bi)
            self.vector_store.add_texts(texts=bt, metadatas=bm, ids=bi)
            print(f"Batch {batch_num} indexed.")

        # Persist
        try:
            self.vector_store.persist()
        except Exception:
            pass

        # Save processed mapping
        self._save_processed(processed)

        print(f"Successfully processed {len(added_files)} new/updated documents.")
        if added_files:
            print("\nFiles newly added to the index in this run:")
            for fname in added_files:
                print(f"  - {fname}")
        else:
            print("\nNo new files were added to the index.")

    def verify_indexing(self) -> None:
        try:
            count = len(self.vector_store.get()["ids"])  # type: ignore[index]
        except Exception:
            count = 0
        print(
            f"\nVerification: Found {count} documents in the '{self.collection_name}' collection."
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Index Nexedi HTML docs into Chroma using LangChain + llama.cpp embeddings."
        )
    )
    parser.add_argument(
        "--source-dir",
        type=str,
        default=os.environ.get("DOC_SOURCE_DIR", "./handbook_rapid_space"),
        help="Directory containing HTML files (default: ./handbook_rapid_space)",
    )
    parser.add_argument(
        "--persist-dir",
        type=str,
        default=os.environ.get("DOC_PERSIST_DIR", "./nexedi_doc_vec_langchain_gemma"),
        help="Directory to persist Chroma (default: ./nexedi_doc_vec_langchain_gemma)",
    )
    parser.add_argument(
        "--collection-name",
        type=str,
        default=os.environ.get("DOC_COLLECTION", "nexedi_doc_langchain_gemma"),
        help="Chroma collection name (default: nexedi_doc_langchain_gemma)",
    )
    parser.add_argument(
        "--embed-base-url",
        type=str,
        default=os.environ.get("EMBED_BASE_URL", "http://localhost:8081"),
        help="Base URL for llama.cpp server (default: http://localhost:8081)",
    )
    parser.add_argument(
        "--log-dir",
        type=str,
        default=os.environ.get("INDEX_LOG_DIR", "./indexing_logs_gemma"),
        help="Directory for processed-files log (default: ./indexing_logs_gemma)",
    )

    args = parser.parse_args()

    indexer = NexediDocIndexerLangChain(
        source_dir=args.source_dir,
        persist_dir=args.persist_dir,
        collection_name=args.collection_name,
        embed_base_url=args.embed_base_url,
        log_file_dir=args.log_dir,
    )
    indexer.load_and_index_docs()
    indexer.verify_indexing()


if __name__ == "__main__":
    main()
