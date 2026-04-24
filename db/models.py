from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime, timezone, timedelta
import uuid

from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True)
    hashed_password = Column(String(255))

    files = relationship("CloudFile", back_populates="uploader")

class CloudFile(Base):
    __tablename__ = "cloud_files"

    id = Column(String(36), primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String(255))
    file_url = Column(String(1000))
    public_id = Column(String(255))
    resource_type = Column(String(20), default="raw")  # image, video, raw
    mime_type = Column(String(100))
    size_bytes = Column(Float)
    
    # 24 hours expiry
    expires_at = Column(DateTime, default=lambda: datetime.now(timezone.utc) + timedelta(hours=24))
    
    uploader_id = Column(Integer, ForeignKey("users.id"))
    uploader = relationship("User", back_populates="files")

class P2PRoom(Base):
    __tablename__ = "p2p_rooms"

    id = Column(String(36), primary_key=True, index=True)
    advanced_mode = Column(Integer, default=0) # 0 for False, 1 for True (Integer used for better cross-db support)
    metadata_json = Column(String(2000), nullable=True) # stores filename, size
    status = Column(String(20), default="active") # active, completed
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
