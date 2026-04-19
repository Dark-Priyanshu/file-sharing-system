from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks
from fastapi.encoders import jsonable_encoder
import json
import uuid
import os
import asyncio
from datetime import datetime, timezone
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from fastapi import Request
import traceback
import cloudinary
import cloudinary.uploader

# Import our new modules
from db.database import engine, Base, get_db, SessionLocal
from db.models import User, CloudFile
from auth.auth import verify_password, get_password_hash, create_access_token, SECRET_KEY, ALGORITHM
import jwt
from jwt.exceptions import InvalidTokenError
from contextlib import asynccontextmanager
from dotenv import load_dotenv
load_dotenv()

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
    while True:
        db = None
        try:
            from db.database import SessionLocal
            db = SessionLocal()
            now = datetime.now(timezone.utc)
            expired_files = db.query(CloudFile).filter(CloudFile.expires_at < now).all()
            for ef in expired_files:
                if ef.public_id:
                    try:
                        cloudinary.uploader.destroy(ef.public_id)
                    except Exception as e:
                        print("Failed to delete from Cloudinary:", e)
                db.delete(ef)
            db.commit()
        except Exception as e:
            print("Cleanup error:", e)
        finally:
            if db:
                db.close()
        await asyncio.sleep(60 * 5)

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
    try:
        name_without_ext = os.path.splitext(file.filename)[0]
        folder_id = str(uuid.uuid4())[:8]

        # We upload the file directly to Cloudinary securely capturing exact filename
        result = cloudinary.uploader.upload(
            file.file, 
            resource_type="auto",
            folder=f"ethershare/{folder_id}",
            public_id=name_without_ext,
            use_filename=True,
            unique_filename=False,
            display_name=file.filename
        )
        file_url = result.get("secure_url")
        public_id = result.get("public_id")
        file_size = result.get("bytes", 0)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")
        
    db_file = CloudFile(
        id=str(uuid.uuid4()), 
        filename=file.filename,
        file_url=file_url,
        public_id=public_id,
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
    db_file = db.query(CloudFile).filter(CloudFile.id == cloud_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found or expired")
    
    url = db_file.file_url

    # Cloudinary image/video transformations only work on image/video endpoints.
    # Raw files do not support fl_attachment transformation, so we just redirect.
    if "/image/upload/" in url or "/video/upload/" in url:
        import urllib.parse
        safe_filename = urllib.parse.quote(db_file.filename)
        url = url.replace("/upload/", f"/upload/fl_attachment:{safe_filename}/")
        
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=url)

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

# In-memory storage for HTTP polling signaling
rooms_messages: dict[str, list[dict]] = {}
room_clients: dict[str, set] = {}
room_metadata: dict[str, dict] = {} # New: Store room settings like advanced_mode

@app.post("/signal/{room_id}/join")
async def join_room(room_id: str, payload: dict):
    client_id = payload.get("client_id")
    if not client_id:
        raise HTTPException(status_code=400, detail="Missing client_id")

    if room_id not in rooms_messages:
        rooms_messages[room_id] = []
        room_clients[room_id] = set()
    
    room_clients[room_id].add(client_id)
    print(f"Client {client_id} joined room: {room_id}. Total users: {len(room_clients[room_id])}")
    
    if len(room_clients[room_id]) == 2:
        metadata = room_metadata.get(room_id, {"advanced": False})
        ready_msg = {
            "type": "ready", 
            "room_id": room_id,
            "advanced": metadata.get("advanced", False),
            "sender_id": "server"
        }
        if not any(msg.get("type") == "ready" for msg in rooms_messages[room_id]):
            rooms_messages[room_id].append(ready_msg)

    return {"status": "joined", "client_count": len(room_clients[room_id])}

@app.post("/signal/{room_id}/send")
async def send_signal(room_id: str, message: dict):
    if room_id not in rooms_messages:
        rooms_messages[room_id] = []
        room_clients[room_id] = set()
    
    rooms_messages[room_id].append(message)
    return {"status": "sent"}

@app.get("/signal/{room_id}/poll")
async def poll_signal(room_id: str, last_index: int = 0):
    if room_id not in rooms_messages:
        return {"messages": [], "last_index": 0}
    
    messages = rooms_messages[room_id][last_index:]
    return {"messages": messages, "last_index": len(rooms_messages[room_id])}

@app.get("/create_room")
async def create_room(advanced: bool = False):
    room_id = str(uuid.uuid4())[:8].upper()
    room_metadata[room_id] = {"advanced": advanced}
    return {"room_id": room_id}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=10000)
