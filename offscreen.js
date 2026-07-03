// ═══════════════════════════════════════════════════════════
// BrowserMCP — Offscreen Document
// Connects TO the relay (relay.py) via WebSocket as a client
// Relay runs at ws://localhost:9274
// ═══════════════════════════════════════════════════════════

let ws = null;
const RELAY_WS_URL = "ws://localhost:9274";
let connected = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_MCP_SERVER") {
    connectToRelay();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "STOP_MCP_SERVER") {
    if (ws) { ws.close(); ws = null; }
    connected = false;
    sendResponse({ ok: true });
    return false;
  }
});

function connectToRelay() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(RELAY_WS_URL);

    ws.onopen = () => {
      console.log("[BrowserMCP] Connected to relay");
      connected = true;
      chrome.runtime.sendMessage({ type: "CLIENT_CONNECTED", clientId: "extension" });
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Forward MCP request to background script
        chrome.runtime.sendMessage({ type: "MCP_REQUEST", data: msg }, (response) => {
          if (response && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(response));
          }
        });
      } catch (e) {
        console.error("[BrowserMCP] Parse error:", e);
      }
    };

    ws.onclose = () => {
      console.log("[BrowserMCP] Disconnected from relay. Reconnecting in 3s...");
      connected = false;
      chrome.runtime.sendMessage({ type: "CLIENT_DISCONNECTED", clientId: "extension" });
      setTimeout(() => {
        // Only reconnect if server is still running
        chrome.runtime.sendMessage({ type: "GET_STATUS" }, (status) => {
          if (status?.running) connectToRelay();
        });
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error("[BrowserMCP] WS error:", err);
    };
  } catch (e) {
    console.error("[BrowserMCP] Connection failed:", e);
    setTimeout(connectToRelay, 3000);
  }
}