import argparse
import os
from langchain_community.document_loaders import BSHTMLLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from custom_embeddings import CustomEmbeddings # Import the new class

def process_in_batches(file_paths, batch_size=100):
    """Yield batches of file paths."""
    for i in range(0, len(file_paths), batch_size):
        yield file_paths[i:i + batch_size]

def main():
    """
    Loads HTML files in batches, splits them, creates embeddings, and stores them in a Chroma vector database.
    """
    parser = argparse.ArgumentParser(description="Vectorize HTML documents and store them in a Chroma DB.")
    parser.add_argument(
        "--input-dir",
        default="handbook_rapid_space",
        help="The directory containing the HTML files to process."
    )
    parser.add_argument(
        "--db-path",
        default="./chroma_db",
        help="The path to store the Chroma vector database."
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
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Number of files to process in each batch."
    )
    args = parser.parse_args()

    if not os.path.isdir(args.input_dir):
        print(f"Error: Input directory '{args.input_dir}' not found.")
        return

    all_html_files = [os.path.join(root, file)
                      for root, _, files in os.walk(args.input_dir)
                      for file in files if file.endswith('.html')]

    if not all_html_files:
        print("No HTML documents found to process.")
        return

    print(f"Found {len(all_html_files)} HTML files to process.")

    print("Initializing embedding model...")
    embeddings = CustomEmbeddings(
        model=args.embedding_model,
        url=args.embedding_url
    )

    print(f"Initializing Chroma vector store at '{args.db_path}'...")
    # Initialize Chroma DB, it will be created if it doesn't exist
    db = Chroma(persist_directory=args.db_path, embedding_function=embeddings)

    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)

    total_chunks_added = 0
    for batch_files in process_in_batches(all_html_files, args.batch_size):
        print(f"Processing batch of {len(batch_files)} files...")
        docs_batch = []
        for file_path in batch_files:
            try:
                # Use BSHTMLLoader for each file
                loader = BSHTMLLoader(file_path)
                docs_batch.extend(loader.load())
            except Exception as e:
                print(f"Could not load file {file_path}: {e}")

        if not docs_batch:
            continue

        chunks = text_splitter.split_documents(docs_batch)
        db.add_documents(chunks) # Add the new chunks to the existing DB
        total_chunks_added += len(chunks)
        print(f"Added {len(chunks)} new chunks to the database.")

    print("\nProcessing complete.")
    print(f"Total chunks added: {total_chunks_added}")
    print(f"Vector store now contains approximately {db._collection.count()} documents.")

if __name__ == "__main__":
    main()
