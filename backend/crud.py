from sqlalchemy.orm import Session
import database, schemas
from passlib.context import CryptContext
from datetime import datetime

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password: str):
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str):
    return pwd_context.verify(plain_password, hashed_password)

# User operations
def get_user_by_username(db: Session, username: str):
    return db.query(database.User).filter(database.User.username == username).first()

def create_user(db: Session, user: schemas.UserCreate):
    hashed_password = get_password_hash(user.password)
    db_user = database.User(username=user.username, hashed_password=hashed_password, email=user.email)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

# Session operations
def get_sessions(db: Session, user_id: int):
    return db.query(database.Session).filter(database.Session.user_id == user_id).order_by(database.Session.created_at.desc()).all()

def create_user_session(db: Session, session: schemas.SessionCreate, user_id: int):
    db_session = database.Session(**session.model_dump(), user_id=user_id)
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session

def get_session(db: Session, session_id: str):
    return db.query(database.Session).filter(database.Session.id == session_id).first()

def update_session_title(db: Session, session_id: str, title: str):
    db_session = db.query(database.Session).filter(database.Session.id == session_id).first()
    if db_session:
        db_session.title = title
        db_session.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(db_session)
    return db_session

def delete_session(db: Session, session_id: str):
    db_session = db.query(database.Session).filter(database.Session.id == session_id).first()
    if db_session:
        db.delete(db_session)
        db.commit()
    return db_session

# Message operations
def create_session_message(db: Session, message: schemas.MessageCreate, session_id: str):
    db_message = database.Message(**message.model_dump(), session_id=session_id)
    db.add(db_message)
    db.commit()
    db.refresh(db_message)
    return db_message

def get_messages_by_session(db: Session, session_id: str):
    return db.query(database.Message).filter(database.Message.session_id == session_id).order_by(database.Message.timestamp).all()
