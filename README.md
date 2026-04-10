# EtherShare 🚀

EtherShare is a high-performance, premium peer-to-peer (P2P) and cloud hybrid file-sharing platform.

## Features
- **Direct P2P Transfer**: Direct browser-to-browser transfer using WebRTC. No servers involved.
- **Secure Cloud Store**: 24-hour temporary encrypted storage for asynchronous sharing.
- **Advanced Engine**: Parallel data channels, adaptive chunking, and resume support.
- **Enterprise Security**: AES-256 encryption and zero-retention policy.
- **Modern UI**: Dark-mode, glassmorphism design with premium 3D illustrations.

## Tech Stack
- **Backend**: FastAPI (Python), SQLite, SQLAlchemy
- **Frontend**: Vanilla JS, TailwindCSS, WebRTC
- **Auth**: JWT-based secure authentication

## Technical Architecture

EtherShare operates as a hybrid platform:
1.  **P2P Mode**: Uses **WebRTC** to create a direct data channel between peers. A FastAPI WebSocket server acts as the signaling layer to exchange SDP offers/answers and ICE candidates.
2.  **Cloud Mode**: Uses a **FastAPI** backend to receive file uploads. Files are stored on the server disk with a 24-hour expiration managed by a background cleanup task.

## API Documentation

### Authentication
- `POST /auth/register`: Register a new account.
- `POST /auth/login`: Authenticate and receive a JWT.
- `PUT /auth/change-password`: Update account password (requires JWT).

### Cloud Sharing
- `POST /cloud/upload`: Upload a file to the 24h store (requires JWT).
- `GET /cloud/myfiles`: List files uploaded by the current user.
- `GET /cloud/metadata/{id}`: Fetch filename and size for a share link.
- `GET /cloud/download/{id}`: Download the direct file.

### P2P Signaling
- `GET /create_room`: Generates a unique Room ID.
- `WS /ws/{room_id}`: WebSocket endpoint for WebRTC signaling.

## How to Run
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Start the server:
   ```bash
   python server/main.py
   ```
3. Open `http://localhost:8001` in your browser.

---
Built with ❤️ by EtherShare Team.
