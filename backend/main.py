import typer
import os
import glob
import hashlib
import json
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from datetime import timedelta
from sqlalchemy.exc import OperationalError

from langchain_core.messages import (
    AIMessage,
    HumanMessage,
)

# from rag_haystack import CleanHybridRAGSystem
from rag_langchain import CleanHybridRAGSystemLC

import database, schemas, crud, auth

app = FastAPI()
cli = typer.Typer()

# Allow CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:8080/v1")
EMBED_BASE_URL = os.environ.get("EMBED_BASE_URL", "http://localhost:8081/v1")

# The model name is not used in llama.cpp service
# Just for keep the OpenAI API compatibility
GENERAL_MODEL = "Qwen3-30B-A3B-Instruct-2507-UD-Q5_K_XL.gguf"
EMBED_MODEL = "bge-m3"

# Dependency to get DB session
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

def ensure_db_tables(db):
    """
    Helper to recreate the sqlite schema if it has not been created yet.
    After OperationalError we must rollback the session before retrying.
    """
    try:
        database.create_db_and_tables()
    finally:
        db.rollback()

def with_db_retry(db, callable_obj):
    """
    Execute a DB callable, recreating the sqlite schema when the initial call
    fails because the database/tables do not exist yet.
    """
    try:
        return callable_obj()
    except OperationalError:
        ensure_db_tables(db)
        return callable_obj()

# Dependency to get RAGSystem instance
def get_rag_system():
    rag_system_instance = CleanHybridRAGSystemLC(
        llm_base_url=LLM_BASE_URL,
        embed_base_url=EMBED_BASE_URL,
        general_model=GENERAL_MODEL,
        embed_model=EMBED_MODEL,
        chroma_path="./nexedi_doc_vec_langchain_gemma",
        collection_name="nexedi_doc_langchain_gemma",
    )
    try:
        yield rag_system_instance
    finally:
        pass # No explicit close needed for CleanHybridRAGSystem currently


# --- Authentication Endpoints ---
@app.post("/register", response_model=schemas.UserResponse)
def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = with_db_retry(
        db, lambda: crud.get_user_by_username(db, username=user.username)
    )
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    return with_db_retry(db, lambda: crud.create_user(db=db, user=user))

@app.post("/token", response_model=schemas.Token)
async def login_for_access_token(form_data: schemas.UserLogin, db: Session = Depends(get_db)):
    user = with_db_retry(
        db, lambda: crud.get_user_by_username(db, username=form_data.username)
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found. Please create a new account."
        )
    if not crud.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

# --- Session Management Endpoints ---
@app.get("/sessions", response_model=List[schemas.SessionResponse])
def get_user_sessions(current_user: schemas.UserResponse = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    sessions = crud.get_sessions(db, user_id=current_user.id)
    return [schemas.SessionResponse.model_validate(s, from_attributes=True) for s in sessions]

@app.post("/sessions", response_model=schemas.SessionResponse)
def create_session(session: schemas.SessionCreate, current_user: schemas.UserResponse = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    db_session = crud.create_user_session(db=db, session=session, user_id=current_user.id)
    return schemas.SessionResponse.model_validate(db_session, from_attributes=True)

@app.get("/sessions/{session_id}", response_model=schemas.SessionResponse)
def get_single_session(session_id: str, current_user: schemas.UserResponse = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    db_session = crud.get_session(db, session_id=session_id)
    if not db_session or db_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    messages = crud.get_messages_by_session(db, session_id=session_id)
    messages = crud.get_messages_by_session(db, session_id=session_id)
    messages_response = [schemas.MessageResponse.model_validate(m, from_attributes=True) for m in messages]
    session_data = db_session.__dict__.copy()
    session_data["messages"] = messages_response
    return schemas.SessionResponse.model_validate(session_data, from_attributes=True)

@app.put("/sessions/{session_id}", response_model=schemas.SessionResponse)
def update_session(session_id: str, session_update: schemas.SessionCreate, current_user: schemas.UserResponse = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    db_session = crud.get_session(db, session_id=session_id)
    if not db_session or db_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    updated_session = crud.update_session_title(db, session_id, session_update.title)
    return schemas.SessionResponse.model_validate(updated_session, from_attributes=True)

@app.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str, current_user: schemas.UserResponse = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    db_session = crud.get_session(db, session_id=session_id)
    if not db_session or db_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    crud.delete_session(db, session_id)
    return

import asyncio

# --- Chat Endpoint (Modified) ---
@app.post("/chat/{session_id}")
async def chat(session_id: str, message: schemas.MessageCreate, current_user: schemas.UserResponse = Depends(auth.get_current_user), db: Session = Depends(get_db), rag_system: CleanHybridRAGSystemLC = Depends(get_rag_system)):
    db_session = crud.get_session(db, session_id=session_id)
    if not db_session or db_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    # Store user message
    crud.create_session_message(db, message, session_id)

    async def stream_generator():
        full_response = ""
        try:
            # Stream the response from the RAG system
            async for item in rag_system.query(message.text):
                if item["type"] == "token":
                    full_response += item["data"]
                    # Use SSE format and ensure immediate sending
                    payload = json.dumps({"type": "token", "data": item["data"]})
                    yield f"data: {payload}\r\n\r\n".encode("utf-8")
                    await asyncio.sleep(0)
                elif item["type"] == "final":
                    source_documents = item["data"]["source_documents"]
                    # Send end signal
                    payload = json.dumps(
                        {
                            "type": "final",
                            "data": {
                                "answer": full_response,
                                "source_documents": source_documents,
                            },
                        }
                    )
                    yield f"data: {payload}\r\n\r\n".encode("utf-8")
                    await asyncio.sleep(0)

            # Persist the bot's complete message to the database after streaming
            if full_response:
                bot_message = schemas.MessageCreate(sender="bot", text=full_response)
                crud.create_session_message(db, bot_message, session_id)

        except Exception as e:
            error_message = f"An error occurred: {str(e)}"
            yield f"data: {json.dumps({'type': 'error', 'data': error_message})}\r\n\r\n"

    # Return SSE formatted response
    response = StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用nginx缓冲
            "Content-Type": "text/event-stream",
        }
    )
    
    # 禁用所有可能的缓冲
    response.background = None
    return response


# --- Initial database creation ---
@app.on_event("startup")
def on_startup():
    database.create_db_and_tables()

def get_file_hash(filepath: str) -> str:
    with open(filepath, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


@cli.command()
def serve():
    """
    Starts the FastAPI server.
    """
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

if __name__ == "__main__":
    cli()
