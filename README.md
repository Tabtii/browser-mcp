# BrowserMCP — AI Browser Control via MCP

> Turn Chrome into an MCP server. Let AI agents control your browser. Zero setup.

## Why BrowserMCP?

| | browser-mcp (us) | mcp-chrome (12k★) | Playwright MCP |
|---|---|---|---|
| **Setup** | 1 click + `python3 relay.py` | `npm install -g mcp-chrome-bridge` + extension | `npm install playwright` + browser download |
| **Dependencies** | Python 3 (pre-installed on macOS/Linux) | Node.js + npm | Node.js + Playwright + browser binaries |
| **User session** | ✅ Uses your logged-in tabs | ✅ Uses your logged-in tabs | ❌ Clean browser, no logins |
| **Tools** | 16 (navigate, click, type, screenshot, DOM, etc.) | 20+ | ~10 |
| **Size** | ~50KB extension + 10KB relay | ~500KB extension + npm package | 300MB+ |

## Quick Start

### 1. Install Extension

1. Download this repo
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the `browser-mcp` folder

### 2. Start Relay

```bash
python3 relay.py
```

No pip install. No npm. No dependencies. Just Python 3.

### 3. Connect Your AI Agent

#### Cursor / Claude Desktop / any MCP client

Add to your MCP config:

```json
{
  "mcpServers": {
    "browser-mcp": {
      "command": "python3",
      "args": ["path/to/relay.py"]
    }
  }
}
```

### 4. Start the Extension

Click the BrowserMCP extension icon → **Start**

## Tools

| Tool | Description |
|---|---|
| `navigate` | Navigate to a URL |
| `screenshot` | Capture visible tab |
| `get_dom` | Extract simplified accessibility tree |
| `click` | Click element by CSS selector |
| `type_text` | Type text into a form field |
| `extract_text` | Get text content from page/selector |
| `scroll` | Scroll up/down |
| `get_tabs` | List all open tabs |
| `switch_tab` | Activate a specific tab |
| `close_tab` | Close a tab |
| `evaluate` | Run JavaScript in the page |
| `get_page_info` | Get title, URL, viewport size |
| `fill_form` | Fill multiple form fields at once |
| `wait` | Wait N milliseconds |
| `press_key` | Simulate keyboard input |
| `get_links` | Extract all links from the page |

## Architecture

```
AI Agent (Claude/Cursor)
    ↕ stdio (JSON-RPC)
relay.py (Python, zero deps)
    ↕ WebSocket (ws://localhost:9274)
Chrome Extension (offscreen document)
    ↕ chrome.scripting API
Browser Tab
```

## Privacy

- All processing happens locally
- No data leaves your machine
- No telemetry, no analytics
- Relay only listens on localhost

## License

MIT