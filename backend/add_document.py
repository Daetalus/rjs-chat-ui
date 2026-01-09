import argparse
import os
import hashlib
from langchain_community.document_loaders import BSHTMLLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from custom_embeddings import CustomEmbeddings

def calculate_file_hash(file_path: str) -> str:
    """Calculates the SHA256 hash of a file's content."""
    hasher = hashlib.sha256()
    with open(file_path, 'rb') as f:
        while chunk := f.read(8192):
            hasher.update(chunk)
    return hasher.hexdigest()

def main():
    """
    Adds a single HTML document to an existing Chroma vector database, preventing duplicates.
    """
    parser = argparse.ArgumentParser(description="Add a single HTML document to the Chroma DB.")
    parser.add_argument("file_path", help="The path to the HTML file to add.")
    parser.add_argument(
        "--db-path",
        default="./chroma_db",
        help="The path to the Chroma vector database."
    )
    parser.add_argument(
        "--embedding-url",
        default="http://localhost/api/embeddings",
        help="The URL for the embedding model API."
    )
    parser.add_argument(
        "--embedding-model",
        default="nomic-embed-text",
        help="The name of the embedding model to use."
    )
    args = parser.parse_args()

    if not os.path.isfile(args.file_path):
        print(f"Error: File '{args.file_path}' not found.")
        return

    file_hash = calculate_file_hash(args.file_path)
    print(f"Calculated hash for {args.file_path}: {file_hash}")

    print("Initializing embedding model...")
    embeddings = CustomEmbeddings(
        model=args.embedding_model,
        url=args.embedding_url
    )

    db = Chroma(persist_directory=args.db_path, embedding_function=embeddings)

    # Check for duplicate using the file hash in metadata
    # Note: ChromaDB's `get` method with `where` clause is used for metadata filtering.
    # We store the hash in a 'file_hash' metadata field.
    existing_docs = db.get(where={"file_hash": file_hash})
    if existing_docs and existing_docs['ids']:
        print(f"Document with hash {file_hash} already exists in the database. Skipping addition.")
        return

    print(f"Loading document: {args.file_path}")
    try:
        loader = BSHTMLLoader(args.file_path)
        document = loader.load()
    except Exception as e:
        print(f"Could not load file {args.file_path}: {e}")
        return

    # Add file_hash to each document's metadata
    for doc in document:
        if doc.metadata is None:
            doc.metadata = {}
        doc.metadata["file_hash"] = file_hash
        doc.metadata["source"] = args.file_path # Also store source for better traceability

    print("Splitting document into chunks...")
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = text_splitter.split_documents(document)
    print(f"Split into {len(chunks)} chunks.")

    print(f"Adding document to vector store at '{args.db_path}'...")
    db.add_documents(chunks)

    print("\nDocument added successfully.")
    print(f"Vector store now contains approximately {db._collection.count()} documents.")

if __name__ == "__main__":
    main()