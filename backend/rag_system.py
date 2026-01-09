from typing import Dict, Any
import logging
import os, sys
from bs4 import BeautifulSoup
from llama_index.core import Settings, VectorStoreIndex, Document
from llama_index.core.callbacks import CallbackManager, LlamaDebugHandler
from llama_index.core.retrievers import VectorIndexRetriever
from llama_index.core.query_engine import RetrieverQueryEngine
from llama_index.core.postprocessor import SimilarityPostprocessor
from llama_index.llms.ollama import Ollama
from llama_index.core.node_parser import MarkdownNodeParser
from llama_index.core import StorageContext
from llama_index.vector_stores.chroma import ChromaVectorStore


from chromadb import PersistentClient

from markdownify import markdownify as md
from custom_embeddings import CustomEmbeddings

class RAGSystem:
    def __init__(
        self,
        chroma_path: str = "./backend/chroma_llama_index_db",
        collection_name: str = "nexedi_docs",
        embed_model_name: str = "nomic-embed-text",
        llm_name: str = "deepseek-r1:14b",
        base_url: str="http://localhost:11434",
        chunk_size: int = 512,
        chunk_overlap: int = 50,
        similarity_threshold: float = 0.7,
        top_k: int = 10,
        content_format: str = "markdown",
    ):
        # Init the RAG system
        self.chroma_path = chroma_path
        self.base_url = base_url
        self.embed_model_name = embed_model_name
        self.llm_name = llm_name
        self.collection_name = collection_name
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.similarity_threshold = similarity_threshold
        self.top_k = top_k
        self.content_format = content_format
        
        # Initialize components
        self._setup_models()
        self._setup_vector_store()
        self._setup_node_parser()

    def _setup_models(self):
        """Setup models"""
        # Embedding model
        self.embed_model = CustomEmbeddings(model=self.embed_model_name, url="http://localhost/api/embeddings")
        
        # Main Ollama LLM
        os.environ["HTTPX_KEEP_ALIVE"] = "false"
        logging.basicConfig(stream=sys.stdout, level=logging.INFO)
        debug = LlamaDebugHandler(print_trace_on_end=True)
        Settings.callback_manager = CallbackManager([debug])
        self.llm = Ollama(
            model=self.llm_name,
            base_url=self.base_url,
            request_timeout=120,
            temperature=0.1,  # Reduce hallucination
            stream=True,
        )
        print("Ollama base_url:")
        print(self.base_url)
        print(self.llm_name)
        
        Settings.embed_model = self.embed_model
        Settings.llm = self.llm

    def _setup_vector_store(self):
        """Setup vector database"""
        # Chroma client
        self.chroma_client = PersistentClient(path=self.chroma_path)
        self.chroma_collection = self.chroma_client.get_or_create_collection(
            name=self.collection_name
        )

        # Create vector store
        self.vector_store = ChromaVectorStore(
            chroma_collection=self.chroma_collection
        )
        self.storage_context = StorageContext.from_defaults(
            vector_store=self.vector_store
        )

    def _setup_node_parser(self):
        """Setup document spliter"""
        self.node_parser = MarkdownNodeParser(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            separator=" ",
        )

    def add_html_documents(self, html_files: list):
        """Load HTML files, convert to Markdown, and store in ChromaDB"""
        documents = []
        for html_file in html_files:
            file_path = html_file["file_path"]
            doc_name = html_file["doc_name"]
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    html_content = f.read()

                text_content = self.parse_html_content(html_content)

                document = Document(
                    text=text_content,
                    metadata={
                        "source": file_path,
                        "doc_name": doc_name,
                        "content_type": "html",
                        "format": self.content_format
                    }
                )
                documents.append(document)
                print(f"Successfully processed and added {file_path}")
            except Exception as e:
                print(f"Failed to process {file_path}: {e}")

        if documents:
            print(f"\nAdding {len(documents)} documents to the index...")
            self.index = VectorStoreIndex.from_documents(
                documents,
                storage_context=self.storage_context,
                node_parser=self.node_parser,
                show_progress=True
            )
            print("Successfully created and stored the index.")

    def parse_html_content(self, html_content: str, source_url: str = "", output_format: str = "markdown") -> str:
        """
        Parse HTML content and convert it to the specified format.

        Args:
            html_content: The HTML content.
            source_url: The source URL.
            output_format: The output format ("markdown" or "text").

        Returns:
            The converted content.
        """
        soup = BeautifulSoup(html_content, 'html.parser')

        # Remove script, style, nav, footer, header, and aside tags
        for script in soup(["script", "style", "nav", "footer", "header", "aside"]):
            script.decompose()

        if output_format == "markdown":
            return md(str(soup), strip=["img", "script", "style", "footer", "nav"])
        else:
            return NotImplementedError("Only markdown converter was implemented")

    def load_existing_index(self):
        """Load an existing index."""
        try:
            print("Loading existing index...")
            collection = self.chroma_client.get_collection(self.collection_name)
            print(f"Found collection: {collection.name}")
            count = collection.count()
            print(f"Number of documents in collection: {count}")
            if count > 0:
                print("Sample document:")
                print(collection.peek())

            self.index = VectorStoreIndex.from_vector_store(
                self.vector_store,
                storage_context=self.storage_context
            )
            print("Successfully loaded existing index.")
            retriever = self.index.as_retriever()
            nodes = retriever.retrieve("test query")
            print(f"Vector store retriever returned {len(nodes)} nodes.")

        except Exception as e:
            print(f"Failed to load index: {str(e)}")
            self.index = None

    def _create_query_engine(self):
        """Create a query engine and optimize for recall."""
        if not hasattr(self, 'index') or self.index is None:
            raise ValueError("Index is not initialized. Please add documents or load an existing index first.")

        # Create a retriever with a larger top_k
        retriever = VectorIndexRetriever(
            index=self.index,
            similarity_top_k=self.top_k,
        )

        # Create a query engine
        query_engine = RetrieverQueryEngine(
            retriever=retriever
        )

        return query_engine

    def query(self, question: str) -> Dict[str, Any]:
        """
        Query a question and return the answer.

        Args:
            question: The user's question.

        Returns:
            A dictionary containing the answer, source documents, and similarity scores.
        """
        try:
            retriever = self.index.as_retriever(similarity_top_k=self.top_k)
            retrieved_nodes = retriever.retrieve(question)
            print(f"Retrieved {len(retrieved_nodes)} nodes before post-processing.")
            for node in retrieved_nodes:
                print(f"  - Node ID: {node.id_}, Score: {node.score}")

            query_engine = self._create_query_engine()

            # Build a prompt that emphasizes answering based on the provided documents.
            enhanced_question = f"""
            Please answer the following question based on the provided document content. 
            If the document does not contain relevant information, please state clearly, "According to the provided documents, I could not find the relevant information."
            Do not invent or speculate on the answer.

            Question: {question}
            """

            response_stream = query_engine.query(enhanced_question)
            
            print("Answer: ", end="")
            # for token in response_stream.response_gen:
            #     print(token, end="", flush=True)
            # print()
            
            response_text = str(response_stream)

            # Extract source document information
            source_docs = []

            if hasattr(response_stream, 'source_nodes') and response_stream.source_nodes:
                for node in response_stream.source_nodes:
                    print("Document node info:")
                    print(node)
                    doc_info = {
                        "doc_name": node.metadata.get("doc_name", "Unknown Document"),
                        "source": node.metadata.get("source", ""),
                        "similarity_score": getattr(node, 'score', 0.0),
                        "content_snippet": node.text[:200] + "..." if len(node.text) > 200 else node.text
                    }
                    source_docs.append(doc_info)

            # Check if relevant documents are found
            if not source_docs:
                return {
                    "answer": "Sorry, I could not find any information related to your question in the existing documents. Please confirm the question or try using different keywords.",
                    "source_documents": [],
                    "confidence": "low"
                }

            return {
                "answer": response_text,
                "source_documents": source_docs,
                "confidence": "high" if source_docs else "low"
            }

        except Exception as e:
            return {
                "answer": f"An error occurred during the query: {str(e)}",
                "source_documents": [],
                "confidence": "error"
            }

def main():
    # Initialize RAG system
    rag_system = RAGSystem(
        chroma_path="./company_knowledge_base",
        collection_name="company_docs",
        base_url= "http://localhost",
        embed_model_name = "nomic-embed-text",
        llm_name="hf.co/unsloth/Qwen3-30B-A3B-GGUF:Q4_K_XL",
        similarity_threshold=0.1,  # Lowered threshold to ensure results pass
        top_k=15
    )
    
    print("Hello!")
    # Add HTML documents
    
    # Add documents on the first run
    # rag_system.add_html_documents(html_files)
    
    # Load existing index on subsequent runs
    rag_system.load_existing_index()

    # Query examples
    questions = [
        "/no_think How to Shipping ORS?",
        "/no_think How to install SlapOS node COMP0?",
    ]

    for question in questions:
        print(f"\nQuestion: {question}")
        result = rag_system.query(question)

        print(f"Confidence: {result['confidence']}")
        # The answer is now streamed, so we don't print it here again.
        print(f"Answer: {result['answer']}")

        if result['source_documents']:
            print("Reference Documents:")
            for i, doc in enumerate(result['source_documents'], 1):
                print(f"  {i}. {doc['doc_name']} (Similarity: {doc['similarity_score']:.3f})")
        print("-" * 80)

if __name__ == "__main__":
    main()
