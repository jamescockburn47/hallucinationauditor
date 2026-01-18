#!/usr/bin/env python3
"""
Vercel serverless function entry point for the FastAPI application.

This module exports the FastAPI app for Vercel's Python runtime.
"""

import sys
from pathlib import Path

# Add the parent directory to path so we can import from scripts/
parent_dir = Path(__file__).parent.parent
sys.path.insert(0, str(parent_dir))
sys.path.insert(0, str(parent_dir / "scripts"))

# Import the FastAPI app from server
from api.server import app

# Vercel expects the app to be named 'app' or 'handler'
# The FastAPI app is already named 'app' in server.py, so we just re-export it
handler = app
