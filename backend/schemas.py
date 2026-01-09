from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import List, Optional

class UserCreate(BaseModel):
    username: str
    password: str
    email: Optional[EmailStr] = None

class UserLogin(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[EmailStr] = None
    created_at: datetime

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class MessageBase(BaseModel):
    sender: str
    text: str

class MessageCreate(MessageBase):
    pass

class MessageResponse(MessageBase):
    id: str
    session_id: str
    timestamp: datetime

    class Config:
        from_attributes = True

class SessionBase(BaseModel):
    title: str

class SessionCreate(SessionBase):
    pass

class SessionResponse(SessionBase):
    id: str
    user_id: int
    created_at: datetime
    updated_at: datetime
    messages: List[MessageResponse] = []

    class Config:
        from_attributes = True
