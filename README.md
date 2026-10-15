> **Copyright © 2025–2026 Nexedi SA.** Developed by Boxiang Sun at Nexedi and published with Nexedi's permission.
> Originally hosted on Nexedi's GitLab; full commit history preserved.

# rjs-chat-ui

A ChatGPT-style documentation assistant: a **hybrid-retrieval RAG backend** (FastAPI + LangChain + Chroma) served by **self-hosted llama.cpp models**, with a front end built in **RenderJS**, Nexedi's gadget-based web framework.

<!-- TODO: add a screenshot or short GIF of the chat UI here -->

## Features

- **Hybrid retrieval**: dense vector search (Chroma, `bge-m3` embeddings) combined with BM25 keyword search, plus a separate title index whose URL matches boost the final ranking.
- **Self-hosted inference**: generation and embeddings both go through OpenAI-compatible **llama.cpp** servers (e.g. `Qwen3-30B-A3B-Instruct`, GGUF quantized). No external API needed.
- **Streaming answers** over Server-Sent Events, rendered as Markdown (markdown-it + DOMPurify).
- **Accounts and chat history**: JWT login, per-user sessions stored with SQLAlchemy.
- **Per-stage profiling**: timings for title retrieval, semantic retrieval, keyword retrieval, merge/rerank, prompt rendering and LLM latency.
- **RenderJS front end**: the UI is split into gadgets (sidebar, chat container, prompt input, auth screen, mobile header) with RSVP promise chains instead of raw event listeners and timers.

## Architecture

```text
Browser (RenderJS gadgets)
   │  JWT auth, SSE stream
   ▼
FastAPI backend ── SQLite (users, sessions, messages)
   │
   ├── Title retriever ──────┐
   ├── Semantic retriever ───┼─► merge & rerank ─► prompt ─► llama.cpp LLM ─► SSE tokens
   └── BM25 keyword search ──┘
          ▲
   Chroma vector stores (documents + titles), embeddings via llama.cpp
```

## Getting started

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
```

Set the endpoints of your llama.cpp servers (OpenAI-compatible):

```bash
export LLM_BASE_URL=http://localhost:8080/v1
export EMBED_BASE_URL=http://localhost:8081/v1
export SECRET_KEY=change-me
```

<!-- TODO: make sure main.py reads these from environment variables -->

### 2. Build the vector databases

The Chroma databases are not committed (they are too large for GitHub). Build them from your HTML documentation:

```bash
python add_nexedi_docs.py       # document chunks
python add_nexedi_docs_title.py # title index
```

<!-- TODO: document the input folder and arguments -->

### 3. Run

```bash
uvicorn main:app --reload
```

Then serve the repository root (e.g. `python -m http.server`) and open `index.html`.

## Related

- [rag-vue-ui](https://github.com/Daetalus/rag-vue-ui): the earlier Vue front end for the same backend.
- [renderjs_gen](https://github.com/Daetalus/renderjs_gen): generating RenderJS gadgets from natural language with a small local model.
