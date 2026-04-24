from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks, Request
from fastapi.encoders import jsonable_encoder
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, JSONResponse, RedirectResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import json
import uuid
import os
import io
import asyncio
import traceback
import time
from datetime import datetime, timezone
import cloudinary
import cloudinary.uploader
import cloudinary.utils
import urllib.parse
import jwt
from jwt.exceptions import InvalidTokenError
from datetime import timedelta
import socketio

load_dotenv()

# ── Allowed MIME types for cloud upload (security: block executables etc.) ──
ALLOWED_MIME_TYPES = {
    # Images
    "image/png", "image/jpeg", "image/jpg", "image/gif",
    "image/webp", "image/svg+xml", "image/bmp", "image/tiff",
    # Video
    "video/mp4", "video/webm", "video/ogg", "video/quicktime",
    "video/x-msvideo", "video/x-matroska",
    # Audio
    "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm",
    "audio/aac", "audio/flac",
    # Documents
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    # Text / code
    "text/plain", "text/csv", "text/html", "text/css", "text/javascript",
    "application/json", "application/xml", "text/xml",
    # Archives
    "application/zip", "application/x-zip-compressed",
    "application/x-rar-compressed", "application/x-7z-compressed",
    "application/gzip", "application/x-tar",
    # Fonts
    "font/ttf", "font/otf", "font/woff", "font/woff2",
    # Data
    "application/octet-stream",
}


# Import our new modules
from db.database import engine, Base, get_db, SessionLocal
from db.models import User, CloudFile, P2PRoom
from auth.auth import verify_password, get_password_hash, create_access_token, SECRET_KEY, ALGORITHM


# Cloudinary Setup
cloudinary.config(
    cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
    api_key=os.environ.get("CLOUDINARY_API_KEY"),
    api_secret=os.environ.get("CLOUDINARY_API_SECRET")
)

Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(cleanup_expired_files())
    yield
    task.cancel()

app = FastAPI(lifespan=lifespan)
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socketio_app = socketio.ASGIApp(sio, app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    err = traceback.format_exc()
    print("CRITICAL ERROR:", err)
    return JSONResponse(status_code=500, content={"detail": str(exc)})

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Mount static files
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
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
    """Background task: runs every 5 min. Also triggered inline on upload/download."""
    while True:
        db = None
        try:
            from db.database import SessionLocal
            db = SessionLocal()
            now = datetime.now(timezone.utc)
            
            # Cleanup expired cloud files
            expired_files = db.query(CloudFile).filter(CloudFile.expires_at < now).all()
            for ef in expired_files:
                if ef.public_id:
                    try:
                        cloudinary.uploader.destroy(ef.public_id)
                    except Exception as e:
                        print("Failed to delete from Cloudinary:", e)
                db.delete(ef)
                
            # Cleanup expired P2P rooms (older than 1 hour)
            one_hour_ago = now - timedelta(hours=1)
            expired_rooms = db.query(P2PRoom).filter(P2PRoom.created_at < one_hour_ago).all()
            for room in expired_rooms:
                db.delete(room)
                
            db.commit()
        except Exception as e:
            print("Cleanup error:", e)
        finally:
            if db:
                db.close()
        await asyncio.sleep(60 * 5)


def run_inline_cleanup(db: Session):
    """
    Inline cleanup helper: called on every upload/download request.
    Deletes expired files from Cloudinary + DB without waiting for the
    background task — improves reliability on free-tier hosting (Render)
    where background tasks may be paused during idle periods.
    """
    try:
        now = datetime.now(timezone.utc)
        expired_files = db.query(CloudFile).filter(CloudFile.expires_at < now).all()
        for ef in expired_files:
            if ef.public_id:
                try:
                    cloudinary.uploader.destroy(ef.public_id, resource_type=ef.resource_type or "raw")
                except Exception as e:
                    print("[Inline Cleanup] Cloudinary destroy failed:", e)
            db.delete(ef)
        if expired_files:
            db.commit()
            print(f"[Inline Cleanup] Removed {len(expired_files)} expired file(s).")
    except Exception as e:
        print("[Inline Cleanup] Error:", e)

@app.post("/auth/register")
def register(email: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
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

@app.post("/cloud/upload")
async def upload_cloud_file(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # ── Inline cleanup: remove expired files on every upload request ──
    run_inline_cleanup(db)

    # ── File type validation (security: block executables & unknown types) ──
    content_type = (file.content_type or "").lower().strip()
    # Strip charset/params (e.g. "text/plain; charset=utf-8" → "text/plain")
    base_content_type = content_type.split(";")[0].strip()
    if base_content_type and base_content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                f"File type '{base_content_type}' is not permitted. "
                "Executables (.exe, .bat, .sh, .msi) and scripts are blocked for security. "
                "Use P2P Live Transfer to send any file type directly between browsers."
            )
        )

    try:
        folder_id = str(uuid.uuid4())[:8]

        # Read the entire file content into memory first to avoid empty pointer issue
        file_content = await file.read()
        if len(file_content) == 0:
            raise HTTPException(status_code=400, detail="File is empty")

        result = cloudinary.uploader.upload(
            io.BytesIO(file_content),
            resource_type="auto",
            folder=f"ethershare/{folder_id}",
            use_filename=True,
            unique_filename=False,
        )
        file_url = result.get("secure_url")
        public_id = result.get("public_id")
        resource_type = result.get("resource_type", "raw")
        file_size = result.get("bytes", 0)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

    db_file = CloudFile(
        id=str(uuid.uuid4()),
        filename=file.filename,
        file_url=file_url,
        public_id=public_id,
        resource_type=resource_type,
        mime_type=file.content_type,
        size_bytes=file_size,
        uploader_id=current_user.id
    )
    db.add(db_file)
    db.commit()
    return {"cloud_id": db_file.id, "expires_at": db_file.expires_at}

@app.get("/cloud/myfiles")
async def get_my_files(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    files = db.query(CloudFile).filter(CloudFile.uploader_id == current_user.id).all()
    return jsonable_encoder([{"id": f.id, "filename": f.filename, "size_bytes": f.size_bytes, "expires_at": f.expires_at} for f in files])

@app.delete("/cloud/{cloud_id}")
async def delete_my_file(cloud_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db_file = db.query(CloudFile).filter(CloudFile.id == cloud_id, CloudFile.uploader_id == current_user.id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found or unauthorized")
        
    if db_file.public_id:
        try:
            cloudinary.uploader.destroy(db_file.public_id)
        except Exception as e:
            print("Failed to delete from Cloudinary:", e)
            
    db.delete(db_file)
    db.commit()
    return {"status": "deleted"}

@app.get("/cloud/download/{cloud_id}")
async def download_cloud_file(cloud_id: str, db: Session = Depends(get_db)):
    # ── Inline cleanup: remove expired files on every download request ──
    run_inline_cleanup(db)

    db_file = db.query(CloudFile).filter(CloudFile.id == cloud_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found or expired")

    # Generate a signed download URL using the attachment flag
    res_type = db_file.resource_type or "auto"

    # We use the attachment flag to force a download with the original filename
    # This is the most reliable "default" way to handle Cloudinary downloads.
    # The filename MUST be URL-encoded, otherwise Cloudinary signature will fail for files with spaces/special characters
    import urllib.parse
    encoded_filename = urllib.parse.quote(db_file.filename)
    
    signed_url, _ = cloudinary.utils.cloudinary_url(
        db_file.public_id,
        resource_type=res_type,
        type="upload",
        sign_url=True,
        flags=f"attachment:{encoded_filename}",
        expires_at=int(time.time()) + 3600
    )

    return JSONResponse({"url": signed_url, "filename": db_file.filename})

@app.get("/cloud/metadata/{cloud_id}")
async def get_cloud_metadata(cloud_id: str, db: Session = Depends(get_db)):
    db_file = db.query(CloudFile).filter(CloudFile.id == cloud_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found or expired")
    return {"filename": db_file.filename, "size": db_file.size_bytes, "mime": db_file.mime_type}

@app.get("/")
async def get_index():
    return FileResponse(os.path.join(BASE_DIR, "templates", "index.html"))

@app.get("/live/{room_id}")
async def get_live_page(room_id: str):
    return FileResponse(os.path.join(BASE_DIR, "templates", "live.html"))

@app.get("/download/{cloud_id}")
async def get_download_page(cloud_id: str):
    return FileResponse(os.path.join(BASE_DIR, "templates", "download.html"))

@app.get('/favicon.ico', include_in_schema=False)
async def favicon():
    return Response(content=b"", media_type="image/x-icon")

@app.get("/config/ice_servers.json")
async def get_ice_servers():
    file_path = os.path.join(BASE_DIR, "config", "stun_servers.json")
    if os.path.exists(file_path):
        with open(file_path, 'r') as f:
            return json.load(f)
    return []

# Socket.io Signaling
room_clients_sio = {} # room_id -> set of sid

@sio.event
async def join_room(sid, data):
    room_id = data.get("room_id")
    client_id = data.get("client_id")
    if not room_id or not client_id:
        return
        
    await sio.enter_room(sid, room_id)
    
    if room_id not in room_clients_sio:
        room_clients_sio[room_id] = set()
    room_clients_sio[room_id].add(sid)
    
    print(f"Client {sid} ({client_id}) joined room {room_id}. Total: {len(room_clients_sio[room_id])}")
    
    # Store sid -> room_id for disconnect handling
    async with sio.session(sid) as session:
        session['room_id'] = room_id
        session['client_id'] = client_id
        
    if len(room_clients_sio[room_id]) == 2:
        # Fetch metadata from DB to send to receiver
        db = SessionLocal()
        try:
            room_record = db.query(P2PRoom).filter(P2PRoom.id == room_id).first()
            advanced_mode = room_record.advanced_mode == 1 if room_record else False
            metadata = json.loads(room_record.metadata_json) if room_record and room_record.metadata_json else {}
            
            ready_msg = {
                "type": "ready",
                "room_id": room_id,
                "advanced": advanced_mode,
                "metadata": metadata,
                "sender_id": "server"
            }
            await sio.emit('signal', ready_msg, room=room_id)
        finally:
            db.close()

@sio.event
async def signal(sid, data):
    room_id = data.get("room_id")
    if room_id:
        # Broadcast to everyone in the room except the sender
        await sio.emit('signal', data, room=room_id, skip_sid=sid)

@sio.event
async def disconnect(sid):
    try:
        async with sio.session(sid) as session:
            room_id = session.get('room_id')
            if room_id and room_id in room_clients_sio:
                if sid in room_clients_sio[room_id]:
                    room_clients_sio[room_id].remove(sid)
                
                # Notify the other peer
                await sio.emit('peer_disconnected', {"sid": sid}, room=room_id)
                
                if len(room_clients_sio[room_id]) == 0:
                    del room_clients_sio[room_id]
    except Exception as e:
        print(f"Disconnect handling error: {e}")

@app.post("/create_room")
async def create_room(payload: dict, db: Session = Depends(get_db)):
    advanced = payload.get("advanced", False)
    metadata = payload.get("metadata", {})
    
    room_id = str(uuid.uuid4())[:8].upper()
    
    new_room = P2PRoom(
        id=room_id,
        advanced_mode=1 if advanced else 0,
        metadata_json=json.dumps(metadata)
    )
    db.add(new_room)
    db.commit()
    
    return {"room_id": room_id}

@app.post("/admin/cleanup")
async def manual_cleanup(db: Session = Depends(get_db)):
    """
    Manual cleanup endpoint: deletes all expired files from Cloudinary + DB.
    Useful for triggering cleanup on free-tier hosting where background tasks
    may not run reliably. Can be called via cron job or manually.
    Note: In production, secure this endpoint with authentication.
    """
    try:
        now = datetime.now(timezone.utc)
        expired_files = db.query(CloudFile).filter(CloudFile.expires_at < now).all()
        deleted_count = len(expired_files)
        for ef in expired_files:
            if ef.public_id:
                try:
                    cloudinary.uploader.destroy(ef.public_id, resource_type=ef.resource_type or "raw")
                except Exception as e:
                    print("[Manual Cleanup] Cloudinary destroy failed:", e)
            db.delete(ef)
            
        one_hour_ago = now - timedelta(hours=1)
        expired_rooms = db.query(P2PRoom).filter(P2PRoom.created_at < one_hour_ago).all()
        for room in expired_rooms:
            db.delete(room)
            
        db.commit()
        return {"status": "ok", "deleted_files": deleted_count, "deleted_rooms": len(expired_rooms)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cleanup failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    # Make sure to run the socketio_app
    uvicorn.run(socketio_app, host="0.0.0.0", port=10000)

