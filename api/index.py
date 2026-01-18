"""
Vercel serverless function entry point.

This is a minimal handler that routes to the FastAPI app.
For Vercel deployment, we need to handle the path setup carefully.
"""

from http.server import BaseHTTPRequestHandler
import json

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        response = {
            "name": "Matthew Lee Bot API",
            "status": "online",
            "version": "0.2.0",
            "message": "API is running. Full functionality requires local deployment due to complex dependencies.",
            "endpoints": {
                "/api": "This endpoint - API status",
                "/api/audit": "POST - Run citation audit (requires local deployment)",
                "/api/extract": "POST - Extract claims from document (requires local deployment)",
                "/api/resolve-citations": "POST - Resolve citations to URLs (requires local deployment)"
            }
        }

        self.wfile.write(json.dumps(response).encode())
        return

    def do_POST(self):
        self.send_response(501)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        response = {
            "error": "Full API functionality requires local deployment",
            "message": "The hallucination auditor has complex Python dependencies (PyMuPDF, spaCy, etc.) that exceed Vercel serverless limits. Please run locally with: python -m api.server",
            "local_setup": "pip install -r requirements.txt && python -m api.server"
        }

        self.wfile.write(json.dumps(response).encode())
        return

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        return
