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
import queue
from http.server import HTTPServer, BaseHTTPRequestHandler

MCP_PORT = 9275
WS_PORT = 9274  # WebSocket port for extension connection
VERSION = "0.1.0"

# ─── WebSocket Server (hand-rolled, zero deps) ───

class WebSocketFrame:
    @staticmethod
    def encode(data: str) -> bytes:
        """Encode a server-to-browser WebSocket text frame.

        Per RFC 6455, client-to-server frames MUST be masked, but
        server-to-client frames MUST NOT be masked. Browser clients close the
        connection with a protocol error if the server masks outbound frames.
        """
        payload = data.encode("utf-8")
        payload_len = len(payload)
        if payload_len < 126:
            header = bytes([0x81, payload_len])
        elif payload_len < 65536:
            header = bytes([0x81, 126]) + struct.pack(">H", payload_len)
        else:
            header = bytes([0x81, 127]) + struct.pack(">Q", payload_len)
        return header + payload

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
pending_responses = {}
pending_lock = threading.Lock()


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

    # Listen for responses from extension. If an HTTP /mcp request is waiting
    # for this JSON-RPC id, deliver it there; otherwise forward to stdout for
    # classic stdio MCP clients.
    while client.alive:
        msg = client.recv()
        if msg:
            try:
                parsed = json.loads(msg)
                msg_id = parsed.get("id")
                if msg_id is not None:
                    with pending_lock:
                        pending = pending_responses.get(msg_id)
                    if pending:
                        pending.put(parsed)
                        continue
                sys.stdout.write(json.dumps(parsed) + "\n")
                sys.stdout.flush()
            except Exception:
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

def call_extension_sync(msg: dict, timeout: float = 30.0) -> dict:
    """Forward an MCP request to the extension and wait for its JSON-RPC response."""
    msg_id = msg.get("id")
    if msg_id is None:
        msg_id = int(time.time() * 1000)
        msg["id"] = msg_id

    with extension_lock:
        client = extension_client if extension_client and extension_client.alive else None
    if not client:
        return {
            "jsonrpc": "2.0", "id": msg_id,
            "error": {"code": -32000, "message": "Browser extension not connected. Open BrowserMCP and click Start."}
        }

    response_queue = queue.Queue(maxsize=1)
    with pending_lock:
        pending_responses[msg_id] = response_queue
    try:
        if not client.send(json.dumps(msg)):
            return {
                "jsonrpc": "2.0", "id": msg_id,
                "error": {"code": -32001, "message": "Failed to send request to BrowserMCP extension."}
            }
        try:
            return response_queue.get(timeout=timeout)
        except queue.Empty:
            return {
                "jsonrpc": "2.0", "id": msg_id,
                "error": {"code": -32002, "message": f"Timeout waiting for BrowserMCP response after {timeout}s."}
            }
    finally:
        with pending_lock:
            pending_responses.pop(msg_id, None)


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
                # Browser control
                "navigate", "screenshot", "get_dom", "click", "type_text",
                "extract_text", "scroll", "get_page_info",
                # Page content
                "get_links", "get_markdown",
                # Tabs
                "get_tabs", "switch_tab", "close_tab", "create_tab", "batch_execute",
                # Forms
                "fill_form", "detect_forms", "auto_fill_form", "drag_and_drop",
                # Recording / playback
                "start_recording", "stop_recording", "playback",
                # Debugging
                "evaluate", "wait", "press_key", "get_console_logs",
                "get_network_requests", "handle_dialog",
                # Smart interaction
                "highlight", "wait_for_element", "get_interactive_elements",
                "click_by_id", "type_by_id", "click_text", "hover"
            ]
        }

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(status, indent=2).encode())

    def do_POST(self):
        if self.path != "/mcp":
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Not found"}).encode())
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8")
            msg = json.loads(body)
        except Exception as e:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": f"Invalid JSON body: {e}"}
            }).encode())
            return

        timeout = 45.0 if msg.get("method") == "tools/call" else 30.0
        response = call_extension_sync(msg, timeout=timeout)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, format, *args):
        pass  # Suppress default logging


def start_http_status():
    server = HTTPServer(("0.0.0.0", MCP_PORT), StatusHandler)
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
    except (KeyboardInterrupt, SystemExit):
        print("\n[BrowserMCP] Shutting down.", file=sys.stderr)
        sys.exit(0)

    # If handle_stdio() returns (stdin EOF), keep server alive for HTTP/WebSocket clients
    print("[BrowserMCP] stdio ended, keeping HTTP/WebSocket server alive...", file=sys.stderr)
    import signal
    signal.pause()