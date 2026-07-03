#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════
# BrowserMCP Relay — Zero-dependency MCP bridge
# Run: python3 relay.py
# Connects AI agents (Claude, Cursor, etc.) via stdio to
# the BrowserMCP Chrome extension via WebSocket.
#
# No npm. No node. No pip. Just python3 (pre-installed on
# macOS/Linux, tiny download on Windows).
# ═══════════════════════════════════════════════════════════

import json
import sys
import threading
import time
import socket
import struct
import hashlib
import base64
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

MCP_PORT = 9275
WS_PORT = 9274  # WebSocket port for extension connection
VERSION = "0.1.0"

# ─── WebSocket Server (hand-rolled, zero deps) ───

class WebSocketFrame:
    @staticmethod
    def encode(data: str) -> bytes:
        payload = data.encode("utf-8")
        mask_bit = 0x80
        payload_len = len(payload)
        if payload_len < 126:
            header = bytes([0x81, payload_len | mask_bit])
        elif payload_len < 65536:
            header = bytes([0x81, 126 | mask_bit]) + struct.pack(">H", payload_len)
        else:
            header = bytes([0x81, 127 | mask_bit]) + struct.pack(">Q", payload_len)
        mask = os.urandom(4)
        masked = bytearray(payload)
        for i in range(len(masked)):
            masked[i] ^= mask[i % 4]
        return header + mask + masked

    @staticmethod
    def decode(data: bytes) -> str:
        if len(data) < 6:
            return ""
        payload_len = data[1] & 0x7F
        offset = 2
        if payload_len == 126:
            payload_len = struct.unpack(">H", data[2:4])[0]
            offset = 4
        elif payload_len == 127:
            payload_len = struct.unpack(">Q", data[2:10])[0]
            offset = 10
        if len(data) < offset + 4 + payload_len:
            return ""
        mask = data[offset:offset + 4]
        offset += 4
        payload = bytearray(data[offset:offset + payload_len])
        for i in range(len(payload)):
            payload[i] ^= mask[i % 4]
        return payload.decode("utf-8")


class ExtensionClient:
    def __init__(self, conn, addr):
        self.conn = conn
        self.addr = addr
        self.alive = True

    def send(self, data: str) -> bool:
        try:
            self.conn.sendall(WebSocketFrame.encode(data))
            return True
        except Exception:
            self.alive = False
            return False

    def recv(self) -> str:
        try:
            data = self.conn.recv(65536)
            if not data:
                self.alive = False
                return ""
            return WebSocketFrame.decode(data)
        except Exception:
            self.alive = False
            return ""

    def close(self):
        try:
            self.conn.close()
        except:
            pass
        self.alive = False


extension_client = None
extension_lock = threading.Lock()


def handle_extension_connection(conn, addr):
    global extension_client
    print(f"[BrowserMCP] Extension connected from {addr}", file=sys.stderr)

    # Send MCP initialize to verify connection
    init_msg = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"clientInfo": {"name": "browser-mcp-relay", "version": VERSION}}
    })

    # Read the WebSocket handshake first
    try:
        handshake_data = conn.recv(4096).decode("utf-8")
        if "Sec-WebSocket-Key" in handshake_data:
            key = handshake_data.split("Sec-WebSocket-Key: ")[1].split("\r\n")[0].strip()
            accept = base64.b64encode(
                hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
            ).decode()
            response = (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            )
            conn.sendall(response.encode())
    except Exception as e:
        print(f"[BrowserMCP] Handshake error: {e}", file=sys.stderr)
        conn.close()
        return

    client = ExtensionClient(conn, addr)
    with extension_lock:
        extension_client = client

    # Listen for responses from extension and forward to stdout
    while client.alive:
        msg = client.recv()
        if msg:
            # Forward to stdout for MCP client
            try:
                parsed = json.loads(msg)
                sys.stdout.write(json.dumps(parsed) + "\n")
                sys.stdout.flush()
            except:
                pass

    print("[BrowserMCP] Extension disconnected", file=sys.stderr)
    with extension_lock:
        if extension_client is client:
            extension_client = None


def start_ws_server():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", WS_PORT))
    server.listen(1)
    print(f"[BrowserMCP] WebSocket server listening on port {WS_PORT}", file=sys.stderr)
    print(f"[BrowserMCP] Waiting for Chrome extension to connect...", file=sys.stderr)

    while True:
        conn, addr = server.accept()
        threading.Thread(target=handle_extension_connection, args=(conn, addr), daemon=True).start()


# ─── stdio MCP handler ───

def forward_to_extension(msg: dict) -> dict:
    """Forward an MCP request to the extension via WebSocket and wait for response."""
    with extension_lock:
        if not extension_client or not extension_client.alive:
            return {
                "jsonrpc": "2.0", "id": msg.get("id"),
                "error": {"code": -32000, "message": "Browser extension not connected. Install the BrowserMCP extension and ensure it's running."}
            }

    extension_client.send(json.dumps(msg))

    # Wait for response (with timeout)
    # The response will be read by the extension listener thread and written to stdout
    # But in stdio mode, we need to read it synchronously
    # This is a simplified approach: we read from the extension directly
    start = time.time()
    while time.time() - start < 30:
        with extension_lock:
            if extension_client and extension_client.alive:
                # The listener thread handles forwarding to stdout
                # We just wait
                time.sleep(0.05)
        # Check if a response appeared on stdin
        # Actually — in this architecture, the extension responses go to stdout
        # directly from the listener thread. So we just need to not block here.
        # The relay just passes everything through.
        break

    return None  # Response is forwarded directly to stdout


def handle_stdio():
    """Read MCP requests from stdin and forward to the extension."""
    print("[BrowserMCP] Relay ready. Connect your MCP client via stdio.", file=sys.stderr)
    print(f"[BrowserMCP] WebSocket endpoint: ws://127.0.0.1:{WS_PORT}", file=sys.stderr)
    print(f"[BrowserMCP] HTTP status endpoint: http://127.0.0.1:{MCP_PORT}", file=sys.stderr)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
        except:
            continue

        # Forward to extension
        with extension_lock:
            if extension_client and extension_client.alive:
                extension_client.send(line)
            else:
                # Return error to MCP client
                error_response = {
                    "jsonrpc": "2.0",
                    "id": msg.get("id"),
                    "error": {
                        "code": -32000,
                        "message": "Browser extension not connected. Install the BrowserMCP Chrome extension, open it, and click Start."
                    }
                }
                sys.stdout.write(json.dumps(error_response) + "\n")
                sys.stdout.flush()


# ─── HTTP status endpoint (for health checks) ───

class StatusHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        with extension_lock:
            connected = extension_client and extension_client.alive

        status = {
            "name": "browser-mcp",
            "version": VERSION,
            "extension_connected": bool(connected),
            "ws_port": WS_PORT,
            "mcp_port": MCP_PORT,
            "tools": [
                "navigate", "screenshot", "get_dom", "click", "type_text",
                "extract_text", "scroll", "get_tabs", "switch_tab", "close_tab",
                "evaluate", "get_page_info", "fill_form", "wait", "press_key", "get_links"
            ]
        }

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(status, indent=2).encode())

    def log_message(self, format, *args):
        pass  # Suppress default logging


def start_http_status():
    server = HTTPServer(("127.0.0.1", MCP_PORT), StatusHandler)
    server.serve_forever()


# ─── Main ───

if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════╗
║       BrowserMCP Relay v{VERSION}            ║
║   Zero-dependency MCP bridge for Chrome   ║
╚══════════════════════════════════════════╝

  WebSocket: ws://127.0.0.1:{WS_PORT}  (for Chrome extension)
  HTTP status: http://127.0.0.1:{MCP_PORT}  (health check)
  stdio: MCP requests from AI agent

  1. Install the BrowserMCP Chrome extension
  2. Click the extension icon → Start
  3. Configure your AI agent to use this relay

  Press Ctrl+C to stop.
""", file=sys.stderr)

    threading.Thread(target=start_ws_server, daemon=True).start()
    threading.Thread(target=start_http_status, daemon=True).start()

    try:
        handle_stdio()
    except KeyboardInterrupt:
        print("\n[BrowerMCP] Shutting down.", file=sys.stderr)
        sys.exit(0)