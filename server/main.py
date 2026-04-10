from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks
from fastapi.encoders import jsonable_encoder
from typing import Dict, List
import json
import uuid
import os
import asyncio
from datetime import datetime, timezone
import aiofiles
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

# Import our new modules
from db.database import engine, Base, get_db, SessionLocal
from db.models import User, CloudFile
from auth.auth import verify_password, get_password_hash, create_access_token, SECRET_KEY, ALGORITHM
import jwt
from jwt.exceptions import InvalidTokenError

"""
Main Entry Point for EtherShare Server.
Handles user authentication, cloud file management, and P2P signaling.
"""

Base.metadata.create_all(bind=engine)

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(cleanup_expired_files())
    yield
    task.cancel()

app = FastAPI(lifespan=lifespan)

from fastapi import Request
from fastapi.responses import JSONResponse
import traceback

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    err = traceback.format_exc()
    print("CRITICAL ERROR:", err)
    return JSONResponse(status_code=500, content={"detail": err})

# Get the absolute path of the current directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Mount static files
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "client", "static")), name="static")
app.mount("/config", StaticFiles(directory=os.path.join(BASE_DIR, "config")), name="config")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """
    Dependency to validate the JWT token and return the current user object.
    Raises 401 Unauthorized if token is invalid or user doesn't exist.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except InvalidTokenError:
        raise credentials_exception
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise credentials_exception
    return user

async def cleanup_expired_files():
    """
    Background task that periodically checks for and deletes expired cloud files.
    Runs every 5 minutes and removes both the database record and the physical file.
    """
    while True:
        db = None
        try:
            from db.database import SessionLocal
            db = SessionLocal()
            now = datetime.now(timezone.utc)
            expired_files = db.query(CloudFile).filter(CloudFile.expires_at < now).all()
            for ef in expired_files:
                if os.path.exists(ef.file_path):
                    try:
                        os.remove(ef.file_path)
                    except:
                        pass
                db.delete(ef)
            db.commit()
        except Exception as e:
            print("Cleanup error:", e)
        finally:
            if db:
                db.close()
        await asyncio.sleep(60 * 5) # Check every 5 minutes

# Lifespan startup task is handled globally above.

@app.post("/auth/register")
def register(email: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    """
    Registers a new user with email and password.
    Enforces a minimum password length of 6 characters.
    """
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    hashed = get_password_hash(password)
    user = User(email=email, hashed_password=hashed)
    db.add(user)
    db.commit()
    return {"message": "Success"}

@app.post("/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    Authenticates a user and returns an OAuth2 compatible access token.
    Uses Bearer token authentication.
    """
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer", "email": user.email}

@app.put("/auth/change-password")
def change_password(
    current_password: str = Form(...),
    new_password: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not verify_password(current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
    current_user.hashed_password = get_password_hash(new_password)
    db.commit()
    return {"message": "Password changed successfully."}

UPLOAD_DIR = os.path.join(BASE_DIR, "data", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/cloud/upload")
async def upload_cloud_file(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Uploads a file to the secure cloud store.
    Files are temporarily stored and automatically deleted after 24 hours.
    Enforces a 500MB size limit.
    """
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1]
    safe_path = os.path.join(UPLOAD_DIR, f"{file_id}{ext}")
    
    total_size = 0
    MAX_SIZE = 500 * 1024 * 1024 # 500 MB limit
    
    try:
        async with aiofiles.open(safe_path, 'wb') as out_file:
            while chunk := await file.read(1024 * 1024): # 1MB chunks
                total_size += len(chunk)
                if total_size > MAX_SIZE:
                    raise HTTPException(status_code=413, detail="File too large. Maximum allowed size is 500MB.")
                await out_file.write(chunk)
    except HTTPException as e:
        os.remove(safe_path)
        raise e
        
    db_file = CloudFile(
        id=file_id, 
        filename=file.filename,
        file_path=safe_path,
        mime_type=file.content_type,
        size_bytes=total_size,
        uploader_id=current_user.id
    )
    db.add(db_file)
    db.commit()
    return {"cloud_id": file_id, "expires_at": db_file.expires_at}

@app.get("/cloud/myfiles")
async def get_my_files(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    files = db.query(CloudFile).filter(CloudFile.uploader_id == current_user.id).all()
    # Format the payload for the frontend
    # Use jsonable_encoder to handle DateTime serialization
    return jsonable_encoder([{"id": f.id, "filename": f.filename, "size_bytes": f.size_bytes, "expires_at": f.expires_at} for f in files])

@app.delete("/cloud/{cloud_id}")
async def delete_my_file(cloud_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_file = db.query(CloudFile).filter(CloudFile.id == cloud_id, CloudFile.uploader_id == current_user.id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found or unauthorized")
        
    if os.path.exists(db_file.file_path):
        try:
            os.remove(db_file.file_path)
        except:
            pass
            
    db.delete(db_file)
    db.commit()
    return {"status": "deleted"}

@app.get("/cloud/download/{cloud_id}")
async def download_cloud_file(cloud_id: str, db: Session = Depends(get_db)):
    db_file = db.query(CloudFile).filter(CloudFile.id == cloud_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found or expired")
    return FileResponse(path=db_file.file_path, filename=db_file.filename, media_type=db_file.mime_type)

@app.get("/cloud/metadata/{cloud_id}")
async def get_cloud_metadata(cloud_id: str, db: Session = Depends(get_db)):
    db_file = db.query(CloudFile).filter(CloudFile.id == cloud_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found or expired")
    return {"filename": db_file.filename, "size": db_file.size_bytes, "mime": db_file.mime_type}

@app.get("/")
async def get_index():
    return FileResponse(os.path.join(BASE_DIR, "client", "index.html"))

@app.get("/live/{room_id}")
async def get_live_page(room_id: str):
    return FileResponse(os.path.join(BASE_DIR, "client", "index.html"))

@app.get("/download/{cloud_id}")
async def get_download_page(cloud_id: str):
    return FileResponse(os.path.join(BASE_DIR, "client", "index.html"))

@app.get('/favicon.ico', include_in_schema=False)
async def favicon():
    return Response(content=b"", media_type="image/x-icon")

# In-memory storage for signaling
rooms: Dict[str, List[WebSocket]] = {}
room_metadata: Dict[str, dict] = {} # New: Store room settings like advanced_mode

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    """
    WebSocket endpoint for P2P signaling.
    Relays WebRTC handshake messages (offers, answers, candidates) between peers in a room.
    Supports a maximum of 2 peers per room.
    """
    await websocket.accept()
    
    if room_id not in rooms:
        rooms[room_id] = []
    
    if len(rooms[room_id]) >= 2:
        await websocket.send_text(json.dumps({"type": "error", "message": "Room is full"}))
        await websocket.close()
        return
    
    rooms[room_id].append(websocket)
    print(f"User joined room: {room_id}. Total users: {len(rooms[room_id])}")
    
    # Notify others in the room
    if len(rooms[room_id]) == 2:
        metadata = room_metadata.get(room_id, {"advanced": False})
        for client in rooms[room_id]:
            await client.send_text(json.dumps({
                "type": "ready", 
                "room_id": room_id,
                "advanced": metadata.get("advanced", False)
            }))

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Relay message to the other peer in the room
            for client in rooms[room_id]:
                if client != websocket:
                    await client.send_text(json.dumps(message))
    except WebSocketDisconnect:
        rooms[room_id].remove(websocket)
        if not rooms[room_id]:
            del rooms[room_id]
        print(f"User left room: {room_id}")
    except Exception as e:
        print(f"Error in room {room_id}: {e}")
        if websocket in rooms[room_id]:
            rooms[room_id].remove(websocket)

@app.get("/create_room")
async def create_room(advanced: bool = False):
    room_id = str(uuid.uuid4())[:8].upper()
    room_metadata[room_id] = {"advanced": advanced}
    return {"room_id": room_id}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
