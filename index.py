import sys
import os

# Add the server directory to the path so internal imports work
# This allows 'import db' and 'import auth' in server/main.py to work
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "server"))

from main import app

# This file acts as the entrypoint for Vercel
