> Copyright © 2025 Nexedi SA. Developed by Boxiang Sun at Nexedi and published with Nexedi's permission.
> Originally hosted on Nexedi's GitLab; full commit history preserved.

Vector Database Setup

This project uses Chroma as its vector database for storing and retrieving document embeddings.

The pre-generated vector database is not included in this repository because of GitHub's file size limitations.

The database is stored locally at:

backend/nexedi_doc_vec_langchain_gemma/chroma.sqlite3

Generating the Vector Database

Before using the application, you need to generate the vector database locally.

Install the project's required dependencies.

Configure the necessary settings and embedding model.

Run the project's document ingestion and indexing process to generate the Chroma vector database.

Once the database has been generated, you can start the application.

The generated database is excluded from Git tracking through .gitignore.

Note: You do not need to commit or upload the generated database. Each user can build it locally from the source documents using the project's indexing process.