from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime, timezone, timedelta
import uuid

from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)

    files = relationship("CloudFile", back_populates="uploader")

class CloudFile(Base):
    __tablename__ = "cloud_files"

    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String)
    file_url = Column(String)
    public_id = Column(String)
    mime_type = Column(String)
    size_bytes = Column(Float)
    
    # 24 hours expiry
    expires_at = Column(DateTime, default=lambda: datetime.now(timezone.utc) + timedelta(hours=24))
    
    uploader_id = Column(Integer, ForeignKey("users.id"))
    uploader = relationship("User", back_populates="files")
