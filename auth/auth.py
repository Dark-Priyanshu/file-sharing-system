import bcrypt
from datetime import datetime, timedelta, timezone
from typing import Optional
import jwt

# Configuration
SECRET_KEY = "ethershare-robust-secure-secret-key-2026-v2" # Increased length for security
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

def verify_password(plain_password: str, hashed_password: str):
    """
    Verifies a plain text password against a hashed password using bcrypt.
    """
    try:
        # bcrypt.checkpw expects bytes
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def get_password_hash(password: str):
    """
    Hashes a password using bcrypt with a generated salt.
    """
    # bcrypt.hashpw expects bytes and a salt
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """
    Generates a JWT access token for a given set of data (usually the user's email).
    Default expiration is set to 24 hours.
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt
