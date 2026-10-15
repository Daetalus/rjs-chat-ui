# -*- coding: utf-8 -*-
# Dependencies:
#   pip install "langchain==0.3.27" "langchain-community>=0.3" "langchain-openai>=0.2.0" "jinja2" "fastapi" "uvicorn" "rank-bm25" "chromadb"
#
# Description:
# - Hybrid: semantic retrieval (top_k*3 pool) + keyword (BM25 optional) + title retrieval reweighting + chunked-document formatting prompt
# - Includes debug printing, full prompt printing, and SSE streaming output

import asyncio
import queue
import threading
import time
import re
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, asdict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Jinja2 for template rendering (LangChain's PromptTemplate does not support for-loops, so we keep Jinja2)
from jinja2 import Template
from langchain_core.prompts import ChatPromptTemplate

from langchain_core.documents import Document as LCDocument
from langchain_core.callbacks.base import BaseCallbackHandler

# Chroma vector store (LangChain wrapper)
from langchain_chroma import Chroma

# Use llama.cpp servers via OpenAI-compatible LangChain clients
try:
    from langchain_openai import OpenAIEmbeddings as LLOpenAIEmbeddings
    from langchain_openai import ChatOpenAI as LCChatOpenAI
except Exception as _e:  # pragma: no cover
    raise ImportError(
        "langchain-openai is required to talk to llama.cpp server (OpenAI-compatible).\n"
        "Install with: pip install langchain-openai"
    ) from _e


# Optional BM25 keyword retrieval
try:
    from rank_bm25 import BM25Okapi
    BM25_AVAILABLE = True
except Exception:
    print("Warning: rank-bm25 not installed. Using semantic search only.")
    print("Install with: pip install rank-bm25")
    BM25_AVAILABLE = False

# Global synchronous token queue (for SSE output)
_sync_token_queue = queue.Queue()

def _print_and_queue(token: str):
    """Print and queue the token for streaming."""
    print(token, end="", flush=True)
    _sync_token_queue.put(token)

SCORE_KEY = "_score"

def set_score(doc, s: float) -> None:
    if doc.metadata is None:
        doc.metadata = {}
    # Write into metadata directly to avoid adding attributes to Pydantic models
    doc.metadata[SCORE_KEY] = float(s)

def get_score(doc, default: float = 0.0) -> float:
    try:
        return float((doc.metadata or {}).get(SCORE_KEY, default))
    except Exception:
        return default

def _now() -> float:
    return time.perf_counter()

def _approx_tokens(s: str) -> int:
    # Roughly count 4 letters as a token
    return max(1, len(s) // 4)

@dataclass
class PerfStats:
    t_embed: float = 0.0
    t_title_retrieve: float = 0.0
    t_semantic_retrieve: float = 0.0
    t_keyword_retrieve: float = 0.0
    t_merge_rerank: float = 0.0
    t_prompt_render: float = 0.0
    t_llm_queue_to_first: float = 0.0
    t_generation_after_first: float = 0.0

    n_sem_pool: int = 0
    n_keyword_pool: int = 0
    n_final_docs: int = 0

    ctx_chars: int = 0
    ctx_tokens_est: int = 0
    prompt_chars: int = 0
    prompt_tokens_est: int = 0

    def __str__(self) -> str:
        return (
            "=== Perf (seconds) ===\n"
            f"  t_embed: {self.t_embed:.3f}\n"
            f"  t_title_retrieve: {self.t_title_retrieve:.3f}\n"
            f"  t_semantic_retrieve: {self.t_semantic_retrieve:.3f}\n"
            f"  t_keyword_retrieve: {self.t_keyword_retrieve:.3f}\n"
            f"  t_merge_rerank: {self.t_merge_rerank:.3f}\n"
            f"  t_prompt_render: {self.t_prompt_render:.3f}\n"
            f"  t_llm_queue_to_first: {self.t_llm_queue_to_first:.3f}\n"
            f"  t_generation_after_first: {self.t_generation_after_first:.3f}\n"
            "=== Sizes ===\n"
            f"  n_sem_pool: {self.n_sem_pool}\n"
            f"  n_keyword_pool: {self.n_keyword_pool}\n"
            f"  n_final_docs: {self.n_final_docs}\n"
            f"  ctx_chars: {self.ctx_chars} (~{self.ctx_tokens_est} tok)\n"
            f"  prompt_chars: {self.prompt_chars} (~{self.prompt_tokens_est} tok)\n"
        )


class QueueStreamCallback(BaseCallbackHandler):
    """Push streamed LLM tokens into the sync queue for SSE."""
    def on_llm_new_token(self, token: str, **kwargs) -> None:
        _print_and_queue(token)

    # Some wrappers won't automatically send a sentinel at the end;
    # here the main thread will place None to indicate the end.


def _meta_get(meta: Dict[str, Any], key: str, default=None):
    """Be compatible with different writers (some put values in meta, some nest meta.meta)."""
    if meta is None:
        return default
    if key in meta:
        return meta.get(key, default)
    inner = meta.get("meta") if isinstance(meta.get("meta"), dict) else {}
    return inner.get(key, default)


class TitleRetrieverLC:
    """Use a separate title/URL vector store for title retrieval."""
    def __init__(self, title_vs: Chroma, top_k: int = 3):
        self.title_vs = title_vs
        self.top_k = top_k

    def run(self, query: str) -> List[Dict[str, str]]:
        # Direct text search (embeds internally)
        results = self.title_vs.similarity_search_with_score(query, k=self.top_k)
        docs_rank_by_title = []
        print(f"Query: {query}\nTitle Retrieval Results:")
        for doc, score in results:
            url = _meta_get(doc.metadata, "url", "")
            print(f" - {doc.page_content} (URL: {url}) Score: {score}")
            # score is the distance, lower is better
            docs_rank_by_title.append({"Title": doc.page_content, "URL": url, "score": score})
        return docs_rank_by_title

    def run_profiled(self, query: str, q_vec=None) -> (List[Dict[str, str]], float):
        """
        Title retrieval with timing. If q_vec is provided and the underlying Chroma collection is available,
        retrieve by vector to avoid re-embedding.
        Returns: (title_docs, elapsed_seconds)
        """
        t0 = _now()
        if q_vec is not None and hasattr(self.title_vs, "_collection"):
            # Use low-level Chroma to query by vector and also get distances without re-embedding
            res = self.title_vs._collection.query(
                query_embeddings=[q_vec],
                n_results=self.top_k,
                include=["documents", "metadatas", "distances"],
            )
            out = []
            ids = res.get("ids", [[]])[0]
            docs = res.get("documents", [[]])[0]
            metas = res.get("metadatas", [[]])[0]
            dists = (res.get("distances", [[]])[0]) or [None] * len(ids)
            for i in range(len(ids)):
                meta = metas[i] or {}
                url = _meta_get(meta, "url", "")
                out.append({"Title": docs[i] or "", "URL": url, "score": float(dists[i]) if dists[i] is not None else None})
            elapsed = _now() - t0
            return out, elapsed
        else:
            # Fallback to the original API (will re-embed internally)
            out = self.run(query)
            elapsed = _now() - t0
            return out, elapsed


class HybridRetrieverLC:
    """
    Hybrid retrieval: semantic retrieval + keyword (BM25) + title reweighting (strong boost on URL matches).
    Optimized weighting and display for chunked documents.
    """
    def __init__(self,
                 doc_vs: Chroma,
                 embeddings: Any,
                 title_weight: float = 6.0,
                 top_k: int = 4):
        self.doc_vs = doc_vs
        self.embeddings = embeddings
        self.top_k = top_k
        self.title_weight = title_weight

        self._prepare_document_corpus()

    def _all_docs(self) -> List[LCDocument]:
        # Read the collection
        raw = self.doc_vs.get(include=["documents", "metadatas", "embeddings"])
        docs = []
        for i in range(len(raw["ids"])):
            content = (raw["documents"][i] or "")
            meta = raw["metadatas"][i] or {}
            doc_id = raw["ids"][i]
            d = LCDocument(page_content=content, metadata=meta, id=doc_id)
            docs.append(d)
        return docs

    def _prepare_document_corpus(self):
        print("🔄 Preparing document corpus for hybrid search...")
        try:
            self.all_documents: List[LCDocument] = self._all_docs()
            print(f"📚 Loading {len(self.all_documents)} document chunks...")
            self.bm25_index = None
            # Corpus are tokens of the title and content.
            # e.g.: ['user_erp5', 'howto', 'customize', 'price', 'lookup', ...]
            # Repeat the title several times to enhance the title weight.

            if BM25_AVAILABLE and self.all_documents:
                corpus = []
                for d in self.all_documents:
                    meta = d.metadata or {}
                    doc_name = _meta_get(meta, "doc_name", "")
                    title = _meta_get(meta, "title", "") or doc_name
                    content = d.page_content or ""

                    effective_title = doc_name
                    # In most cases, title and doc_name should be identical
                    if title and title != doc_name:
                        effective_title = f"{effective_title} {title}"

                    # In future, we may apply different scores based on chunk_type.
                    # e.g.: chunk_type = _meta_get(meta, "chunk_type", "content")
                    # if chunk_type == "instructions":
                    # XXX: In future, we can adjust the scores based on the chunk type
                    # Attach the score in metadata
                    enhanced_text = f"{effective_title} " * int(self.title_weight * 3) + content

                    tokens = re.findall(r"\b\w+\b", enhanced_text.lower())
                    corpus.append(tokens)

                if corpus and any(tokens for tokens in corpus):
                    self.bm25_index = BM25Okapi(corpus)
                    print("✅ BM25 index created successfully with enhanced chunked-document support")
                else:
                    print("❌ Empty corpus, BM25 disabled")
        except Exception as e:
            print(f"❌ Error preparing document corpus: {e}")
            self.all_documents = []
            self.bm25_index = None

    def _bm25_search(self, query: str, top_k: int) -> List[LCDocument]:
        try:
            if not (BM25_AVAILABLE and self.bm25_index and self.all_documents):
                return []
            query_tokens = re.findall(r"\b\w+\b", query.lower())
            print("BM25_AVAILABLE, query tokens:")
            # print(query_tokens)
            if not query_tokens:
                return []
            scores = self.bm25_index.get_scores(query_tokens)
            top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[: top_k * 2]
            # print(top_indices)
            results = []
            for idx in top_indices:
                if idx < len(self.all_documents):
                    d = self.all_documents[idx]
                    meta = d.metadata or {}
                    chunk_type = _meta_get(meta, "chunk_type", "content")
                    base = float(scores[idx])
                    # if chunk_type == "instructions":
                    # XXX: In future, we can adjust the scores based on the chunk type
                    # Attach the score in metadata
                    set_score(d, base)
                    results.append(d)
            results.sort(key=lambda x: getattr(x, "score", 0.0), reverse=True)
            return results[:top_k]
        except Exception as e:
            print(f"❌ BM25 search error: {e}")
            return []

    def _simple_keyword_search(self, query: str, top_k: int) -> List[LCDocument]:
        if not self.all_documents:
            return []
        q_terms = set(re.findall(r"\b\w+\b", query.lower()))
        if not q_terms:
            return []
        scored = []
        for d in self.all_documents:
            meta = d.metadata or {}
            doc_name = _meta_get(meta, "doc_name", "unknown")
            title = doc_name.lower()
            content = (d.page_content or "").lower()
            chunk_type = _meta_get(meta, "chunk_type", "content")

            t_matches = sum(1 for t in q_terms if t in title)
            c_matches = sum(1 for t in q_terms if t in content)

            weight = 1.0
            if chunk_type == "instructions":
                weight = 1.3
            elif chunk_type == "section":
                weight = 1.2
            elif chunk_type == "troubleshooting":
                weight = 1.1

            total = (t_matches * self.title_weight + c_matches) * weight
            if total > 0:
                d2 = LCDocument(page_content=d.page_content, metadata=meta, id=d.id)
                set_score(d2, float(total))
                scored.append(d2)
        scored.sort(key=lambda x: getattr(x, "score", 0.0), reverse=True)
        return scored[:top_k]

    def _keyword_search(self, query: str, top_k: int) -> List[LCDocument]:
        if BM25_AVAILABLE and self.bm25_index:
            print("BM25_AVAILABLE")
            return self._bm25_search(query, top_k)
        print("BM25_NOT_AVAILABLE")
        return self._simple_keyword_search(query, top_k)

    def _merge_and_rerank(self,
                          query: str,
                          semantic_docs: List[LCDocument],
                          keyword_docs: List[LCDocument],
                          title_url_list: List[str]) -> List[LCDocument]:
        doc_map: Dict[str, LCDocument] = {}

        # Merge semantic results
        for d in semantic_docs:
            if d.id not in doc_map:
                if not hasattr(d, "score"):
                    score = get_score(d)
                doc_map[d.id] = d

        # Merge keyword results (add score on the same ID)
        for d in keyword_docs:
            if d.id in doc_map:
                s = get_score(doc_map[d.id]) + get_score(d)
                set_score(doc_map[d.id], s)
            else:
                doc_map[d.id] = d

        print("==================")

        merged = list(doc_map.values())

        # Strongly boost when the URL matches one of the title URLs
        for d in merged:
            meta = d.metadata or {}
            url = _meta_get(meta, "url", "")
            if url and url in title_url_list:
                set_score(d, get_score(d) * 1.5)

        merged.sort(key=lambda x: get_score(x, "score"), reverse=True)
        return merged[: self.top_k]

    def run_profiled(self,
                     query: str,
                     title_url_list: Optional[List[str]] = None,
                     q_vec=None,
                     pool_k: int = 50):
        """
        Hybrid retrieval with timing. If q_vec is provided and low-level Chroma collection is available,
        semantic retrieval runs by vector (no re-embed). Otherwise, fall back to regular API.
        Returns: (final_docs, timings)
        """
        timings = {
            "t_semantic_retrieve": 0.0,
            "t_keyword_retrieve": 0.0,
            "t_merge_rerank": 0.0,
            "n_sem_pool": 0,
            "n_keyword_pool": 0,
        }

        title_url_list = title_url_list or []

        # Semantic retrieval
        t0 = _now()
        semantic_docs = []
        if q_vec is not None and hasattr(self.doc_vs, "_collection"):
            res = self.doc_vs._collection.query(
                query_embeddings=[q_vec],
                n_results=min(pool_k, 80),
                include=["documents", "metadatas", "distances"],
            )
            ids = res.get("ids", [[]])[0]
            docs = res.get("documents", [[]])[0]
            metas = res.get("metadatas", [[]])[0]
            dists = (res.get("distances", [[]])[0]) or [None] * len(ids)
            for i in range(len(ids)):
                doc = LCDocument(page_content=docs[i] or "", metadata=metas[i] or {}, id=ids[i])
                score = dists[i]
                d = LCDocument(page_content=doc.page_content, metadata=doc.metadata, id=doc.id)
                try:
                    s = float(score)
                    s = 1.0 / (1.0 + s)
                except Exception:
                    s = float(score) if isinstance(score, (int, float)) else 0.0
                set_score(d, s)
                semantic_docs.append(d)
        else:
            sem_with_score = self.doc_vs.similarity_search_with_score(query, k=min(pool_k, 80))
            for doc, score in sem_with_score:
                d = LCDocument(page_content=doc.page_content, metadata=doc.metadata, id=doc.id)
                try:
                    s = float(score)
                    s = 1.0 / (1.0 + s)
                except Exception:
                    s = float(score) if isinstance(score, (int, float)) else 0.0
                set_score(d, s)
                semantic_docs.append(d)
        timings["t_semantic_retrieve"] = _now() - t0
        timings["n_sem_pool"] = len(semantic_docs)

        # Keyword retrieval (BM25 or fallback)
        t0 = _now()
        keyword_docs = self._keyword_search(query, top_k=min(pool_k, 50))
        timings["t_keyword_retrieve"] = _now() - t0
        timings["n_keyword_pool"] = len(keyword_docs)

        # Merge & rerank
        t0 = _now()
        final_docs = self._merge_and_rerank(query, semantic_docs, keyword_docs, title_url_list)
        timings["t_merge_rerank"] = _now() - t0

        return final_docs, timings

    def run(self,
            query: str,
            title_url_list: Optional[List[str]] = None,
            pool_k: int = 50) -> List[LCDocument]:
        print(f"🔍 Hybrid retrieval for: '{query}' (chunked document mode)")
        title_url_list = title_url_list or []

        # Semantic retrieval (larger candidate pool)
        # Using the method with score; note different wrappers may return cosine distance or similarity
        sem_with_score = self.doc_vs.similarity_search_with_score(query, k=min(pool_k, 80))
        semantic_docs = []
        for doc, score in sem_with_score:
            d = LCDocument(page_content=doc.page_content, metadata=doc.metadata, id=doc.id)
            # Convert "distance" to a positive score (Chroma returns distance by default, smaller is better)
            try:
                s = float(score)
                s = 1.0 / (1.0 + s)  # distance -> similarity in (0,1]
            except Exception:
                s = float(score) if isinstance(score, (int, float)) else 0.0
            set_score(d, s)
            semantic_docs.append(d)
        print(f"📊 Semantic search: {len(semantic_docs)} document chunks")

        # Keyword retrieval
        keyword_docs = self._keyword_search(query, top_k=min(pool_k, 50))
        print(f"📊 Keyword search: {len(keyword_docs)} document chunks")

        # Merge and rerank
        final_docs = self._merge_and_rerank(query, semantic_docs, keyword_docs, title_url_list)
        print(f"📊 Final results: {len(final_docs)} document chunks")

        # For display
        print("🏆 Top retrieval results:")
        seen = set()
        for i, d in enumerate(final_docs[:10]):
            meta = d.metadata or {}
            doc_name = _meta_get(meta, "doc_name", "unknown")
            chunk_type = _meta_get(meta, "chunk_type", "content")
            chunk_id = _meta_get(meta, "chunk_id", "?")
            score = get_score(d, "score")
            is_new = doc_name not in seen
            seen.add(doc_name)
            boosted = "🚀" if _meta_get(meta, "url", "") in title_url_list else "  "
            marker = "🆕" if is_new else "  "
            print(f"  {i+1:2d}. {marker}{boosted} [Score: {score:6.2f}] {doc_name} (chunk {chunk_id}, {chunk_type})")
            print(f"       Content: {d.page_content[:80]}...")
        return final_docs


class CleanHybridRAGSystemLC:
    def __init__(self,
                 llm_base_url: str,
                 embed_base_url: str,
                 general_model: str,
                 embed_model: str,
                 chroma_path: str,
                 collection_name: str):
        self.llm_base_url = llm_base_url
        self.embed_base_url = embed_base_url
        self.general_model = general_model
        self.embed_model = embed_model
        self.chroma_path = chroma_path
        self.collection_name = collection_name

        # Embeddings (use llama.cpp server via OpenAI-compatible endpoint)
        # Note: llama.cpp server ignores api_key but LangChain requires a non-empty string
        self.embeddings = LLOpenAIEmbeddings(
            model=self.embed_model,
            base_url=self.embed_base_url,
            api_key="EMPTY",
        )

        # Vector store: document store
        self.doc_vs = Chroma(
            collection_name=self.collection_name,
            persist_directory=self.chroma_path,
            embedding_function=self.embeddings
        )
        # Vector store: title store
        self.title_vs = Chroma(
            collection_name="nexedi_doc_titles_gemma",
            persist_directory="./nexedi_doc_title_vec_langchain_gemma",
            embedding_function=self.embeddings
        )

        # Title retriever
        self.title_retriever = TitleRetrieverLC(self.title_vs, top_k=3)

        # Hybrid retriever
        self.hybrid_retriever = HybridRetrieverLC(
            doc_vs=self.doc_vs,
            embeddings=self.embeddings,
            top_k=4,
            title_weight=6.0
        )

        # Generation model (streaming enabled) via llama.cpp server (OpenAI-compatible)
        self.llm = LCChatOpenAI(
            model=self.general_model,
            base_url=self.llm_base_url,
            api_key="EMPTY",
            streaming=True,
        )

        # Split prompt into a fixed system prompt and a dynamic user/context template
        self.system_prompt = (
            "You are Nexedi Document Assistant. Answer STRICTLY from the provided context. "
            "Do NOT invent or infer facts beyond it. Reply in the SAME language as the user query. "
            "Do not display internal metadata (chunk numbers, scores, IDs) in the answer.\n\n"
            "# INTENT (internal; do NOT print labels)\n"
            "Classify the user request into ONE of: Concept/Definition | How-to/Setup | Troubleshooting | "
            "Factual Lookup | Follow-up/Correction | Unclear.\n\n"
            "# ANSWERING RULES\n"
            "1) If EVIDENCE_COUNT = 0 OR no relevant info exists: Output exactly: \"Not specified in the provided documents.\"\n"
            "2) If intent = Unclear: Ask up to 2 concise clarification questions. Do not assume details.\n"
            "3) If intent = Follow-up/Correction: Acknowledge the change briefly. If the new point is not supported by context, "
            "state: \"Missing relevant documents, unable to verify.\" Do not add new facts.\n"
            "4) Otherwise (info exists), produce a well-structured Markdown answer that follows the STYLE rules.\n"
            "5) General constraints: Quote exact wording only when present; otherwise paraphrase. If only partial coverage exists, "
            "answer what IS specified and state what is \"Not specified in the provided documents.\" Use markdown format.\n\n"
            "# OUTPUT STYLE – MARKDOWN\n"
            "- Use the following section order; omit any section that would be empty:\n"
            "  ## Overview\n  A single concise sentence summarizing the answer.\n\n"
            "  ## Details\n  - For Concept/Definition → short definition + bullet key points.\n"
            "  - For How-to/Setup → numbered steps (1., 2., 3.). Put commands/configs in fenced code blocks with language hints (```bash, ```yaml, ```json).\n"
            "  - For Troubleshooting → use subsections: **Symptoms** (bullets) → **Checks** (numbered) → **Fixes** (numbered).\n"
            "  - For Factual Lookup → the fact(s) with exact values/quotes if present (use inline code for keys/flags/filenames).\n\n"
            "  ## Notes\n  Include only if the documents provide warnings, limits, versions, prerequisites. Use short bullets.\n\n"
            "  ## References\n  List only sources actually used, deduplicated. One per line as: [Title](URL)\n\n"
            "- Formatting conventions: Prefer inline code for file names, CLI flags, config keys; keep lists tight; use bold labels sparingly; "
            "one empty line between sections; no trailing blank lines."
        )

        # New Jinja2 context template for retrieved chunks and user question
        self.context_template = Template(
            """# CONTEXT
EVIDENCE_COUNT: {{ documents|length }}

{% for doc in documents %}
--- Context ---
Source: {{ doc.meta.doc_name or "Unknown Document" }} ({{ doc.meta.chunk_type or "content" }})
Content:
{{ doc.content }}
{% endfor %}

# REFERENCES (catalog only; cite only those you actually use)
{% for doc in document_title_and_url %}
- {{ doc.Title }} — {{ doc.URL }}
{% endfor %}

# USER QUESTION
{{ query }}
"""
        )

        # ChatPromptTemplate combining system and user messages
        self.chat_prompt = ChatPromptTemplate.from_messages([
            ("system", self.system_prompt),
            ("user", "{context}"),
        ])

        print("✅ Clean Hybrid RAG (LangChain, llama.cpp) initialized for chunked documents with TitleRetriever!")

    def _render_context(self, docs: List[LCDocument], query: str, title_docs: List[Dict[str, str]]) -> str:
        # Adapt LangChain Document to the fields required by the template
        docs_for_tpl = []

        # 1) Collect candidates (filter low scores first)
        candidates = []
        for d in docs:
            meta = d.metadata or {}
            s = float(get_score(d, 0.0))   # ensure float
            if s < 10:
                continue
            candidates.append({
                "score": s,
                "tpl": {
                    "content": d.page_content,
                    "score": s,
                    "meta": {
                        "doc_name": _meta_get(meta, "doc_name", "Unknown Document"),
                        "chunk_type": _meta_get(meta, "chunk_type", "content"),
                        "chunk_id": _meta_get(meta, "chunk_id", "?"),
                    }
                }
            })

        # 2) Sort by score (desc)
        candidates.sort(key=lambda x: x["score"], reverse=True)

        # 3) Ratio filtering: if the previously kept score >= 1.5 * current score, drop the current one
        last_kept_score = None
        for c in candidates:
            s = c["score"]
            if last_kept_score is None:
                docs_for_tpl.append(c["tpl"])
                last_kept_score = s
                continue
            if last_kept_score >= 1.5 * s:
                # drop
                continue
            # keep
            docs_for_tpl.append(c["tpl"])
            last_kept_score = s

        if len(docs_for_tpl) == 0:
            title_docs = title_docs[0:0]

        context = self.context_template.render(
            documents=docs_for_tpl,
            query=query,
            document_title_and_url=title_docs
        )
        return context

    def _print_debug_prompt(self, prompt: str, final_docs: List[LCDocument], query: str):
        print("\n===== DEBUG PROMPT (chunked-doc mode) =====")
        print(prompt)
        print("===== END PROMPT =====\n")

        # Also show the working set
        print("Working set (top chunks):")
        for i, d in enumerate(final_docs[:8]):
            meta = d.metadata or {}
            doc_name = _meta_get(meta, "doc_name", "unknown")
            chunk_type = _meta_get(meta, "chunk_type", "content")
            chunk_id = _meta_get(meta, "chunk_id", "?")
            score = get_score(d, 0.0)
            print(f"  {i+1:2d}. [Score: {score:6.2f}] {doc_name} (chunk {chunk_id}, {chunk_type})")
        print("Query:", query)

    def query_profiled(self, question: str, pool_k: int = 50):
        """
        A fully profiled pipeline run that measures timings and sizes across the RAG stages
        (title retrieval, semantic retrieval, keyword retrieval, merge & rerank, prompt render, LLM latency).
        Returns: (answer, final_docs, PerfStats, title_documents_for_frontend)
        """
        stats = PerfStats()

        # 1) Title retrieval
        t0 = _now()
        # We embed once here for both title and doc retrieval paths if low-level vector query is available
        q_vec = None
        try:
            q_vec = self.embeddings.embed_query(question)
        except Exception:
            q_vec = None
        title_docs, t_title = self.title_retriever.run_profiled(question, q_vec=q_vec)
        stats.t_title_retrieve = t_title
        title_url_list = [t["URL"] for t in title_docs if t.get("URL")]

        # 2) Hybrid retrieval (semantic + keyword + title boost)
        final_docs, tdict = self.hybrid_retriever.run_profiled(
            query=question,
            title_url_list=title_url_list,
            q_vec=q_vec,
            pool_k=pool_k
        )
        stats.t_semantic_retrieve = tdict["t_semantic_retrieve"]
        stats.t_keyword_retrieve = tdict["t_keyword_retrieve"]
        stats.t_merge_rerank = tdict["t_merge_rerank"]
        stats.n_sem_pool = tdict["n_sem_pool"]
        stats.n_keyword_pool = tdict["n_keyword_pool"]
        stats.n_final_docs = len(final_docs)

        # 4) Prepare/estimate context size (approx; same docs later go into Jinja2 template)
        ctx = "\n\n".join([d.page_content or "" for d in final_docs])
        stats.ctx_chars = len(ctx)
        stats.ctx_tokens_est = _approx_tokens(ctx)

        # 5) Render the user/context template (Jinja2) and compute combined prompt length for stats
        t0 = _now()
        context = self._render_context(final_docs, question, title_docs)
        stats.t_prompt_render = _now() - t0
        combined_for_len = f"{self.system_prompt}\n\n{context}"
        stats.prompt_chars = len(combined_for_len)
        stats.prompt_tokens_est = _approx_tokens(combined_for_len)

        # 6) Send to LLM via ChatPromptTemplate and measure latencies
        response_parts = []
        first_ts = None
        t_send = _now()
        chain = self.chat_prompt | self.llm
        for chunk in chain.stream({"context": context}):
            if first_ts is None:
                first_ts = _now()
                stats.t_llm_queue_to_first = first_ts - t_send
            piece = getattr(chunk, "content", None)
            if piece is None:
                piece = str(chunk)
            response_parts.append(piece)
        t_end = _now()
        if first_ts is not None:
            stats.t_generation_after_first = t_end - first_ts

        answer = "".join(response_parts)

        # Prepare title docs for frontend (same shape as your /chat output)
        title_documents_for_frontend = [{"title": d.get("Title", "Unknown Title"), "url": d.get("URL", "")}
                                        for d in title_docs]

        return answer, final_docs, stats, title_documents_for_frontend

    async def query(self, question: str):
        # Clear the token queue
        while not _sync_token_queue.empty():
            try:
                _sync_token_queue.get_nowait()
            except Exception:
                break

        pipeline_results = {}

        def run_sync():
            try:
                print(f"🔍 Processing query: '{question}' (LangChain pipeline, llama.cpp backend)")
                # Title retrieval
                title_docs = self.title_retriever.run(question)
                title_url_list = [t["URL"] for t in title_docs if t.get("URL")]

                # Hybrid retrieval
                final_docs = self.hybrid_retriever.run(question, title_url_list=title_url_list, pool_k=50)

                # Render context and print combined debug prompt
                context = self._render_context(final_docs, question, title_docs)
                self._print_debug_prompt(f"{self.system_prompt}\n\n{context}", final_docs, question)

                # Build chat prompt and invoke; streaming tokens are sent by the callback
                cb = QueueStreamCallback()
                chain = self.chat_prompt | self.llm
                _ = chain.invoke({"context": context}, config={"callbacks": [cb]})

                pipeline_results["final_docs"] = final_docs
                pipeline_results["title_docs"] = title_docs
                pipeline_results["prompt_len"] = len(self.system_prompt) + 2 + len(context)
            except Exception as e:
                print(f"❌ Pipeline error: {e}")
                import traceback
                traceback.print_exc()
            finally:
                _sync_token_queue.put(None)  # end sentinel

        t = threading.Thread(target=run_sync, daemon=True)
        t.start()

        full_response = ""
        print("\n🤖 Generating response for chunked documents with TitleRetriever...")
        while True:
            token = await asyncio.to_thread(_sync_token_queue.get)
            if token is None:
                break
            full_response += token
            yield {"type": "token", "data": token}

        t.join()

        # Prepare source info for the frontend (grouped by original document)
        source_documents_for_frontend = []
        if "final_docs" in pipeline_results:
            docs = pipeline_results["final_docs"]
            groups: Dict[str, List[LCDocument]] = {}
            for d in docs:
                name = _meta_get(d.metadata, "doc_name", "Unknown Document")
                groups.setdefault(name, []).append(d)
            for name, chunks in groups.items():
                best = max(chunks, key=lambda x: getattr(x, "score", 0.0))
                avg = sum(getattr(c, "score", 0.0) for c in chunks) / max(1, len(chunks))
                source_documents_for_frontend.append({
                    "doc_name": name,
                    "source": _meta_get(best.metadata, "source", ""),
                    "url": _meta_get(best.metadata, "url", ""),
                    "content_snippet": best.page_content[:200],
                    "score": avg,
                    "chunk_count": len(chunks),
                    "chunk_types": list({ _meta_get(c.metadata, "chunk_type", "content") for c in chunks })
                })

        title_documents_for_frontend = []
        if "title_docs" in pipeline_results:
            for tdoc in pipeline_results["title_docs"]:
                title_documents_for_frontend.append({
                    "title": tdoc.get("Title", "Unknown Title"),
                    "url": tdoc.get("URL", "")
                })

        if "prompt_len" in pipeline_results:
            print(f"   - Prompt length: {pipeline_results['prompt_len']} characters")

        yield {
            "type": "final",
            "data": {
                "answer": full_response,
                "source_documents": source_documents_for_frontend,
                "title_documents": title_documents_for_frontend,
                "confidence": "high"
            }
        }


# ============================
# FastAPI app
# ============================
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# Configuration (same as the original script)
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8080/v1")
EMBED_BASE_URL = os.environ.get("EMBED_BASE_URL", "http://localhost:8081/v1")
# The model name is not used in llama.cpp service
# Just for keep the OpenAI API compatibility
GENERAL_MODEL = "Qwen3-30B-A3B-Instruct-2507-UD-Q5_K_XL.gguf"
EMBED_MODEL = "bge-m3"

rag_system = CleanHybridRAGSystemLC(
    llm_base_url=LLM_BASE_URL,
    embed_base_url=EMBED_BASE_URL,
    general_model=GENERAL_MODEL,
    embed_model=EMBED_MODEL,
    chroma_path="./nexedi_doc_vec_langchain_gemma",
    collection_name="nexedi_doc_langchain_gemma",
)


class QuestionRequest(BaseModel):
    question: str


@app.post("/chat")
async def chat(request: QuestionRequest):
    from fastapi.responses import StreamingResponse
    import json

    async def generate_response():
        async for item in rag_system.query(request.question):
            if item["type"] == "token":
                yield f"data: {json.dumps({'type': 'token', 'data': item['data']})}\n\n"
            elif item["type"] == "final":
                yield f"data: {json.dumps({'type': 'final', 'data': item['data']})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate_response(), media_type="text/plain")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Clean Hybrid RAG System (LangChain, llama.cpp) - Chunked Documents with TitleRetriever")
    parser.add_argument("--question", type=str, required=True, help="Question to ask")
    parser.add_argument("--profile", action="store_true", help="Run profiled RAG pipeline")
    args = parser.parse_args()

    if args.profile:
        ans, docs, stats, title_docs = rag_system.query_profiled(args.question, pool_k=50)
        print(stats)  # pretty print timings and sizes
        print("\n--- Answer ---\n")
        print(ans)
        raise SystemExit(0)
    else:
        async def run_test_query(q: str):
            print(f"Question: {q}")
            print("=" * 80)
            full_answer = ""
            async for item in rag_system.query(q):
                if item["type"] == "token":
                    full_answer += item["data"]
                elif item["type"] == "final":
                    _ = item["data"]
            # You may print a summary or add assertions here

        asyncio.run(run_test_query(args.question))
