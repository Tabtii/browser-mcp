# BrowserMCP — AI Browser Control via MCP

## Verleihen Sie KI-Agenten die Kontrolle über Ihren Browser

BrowserMCP verwandelt Chrome in einen MCP-Server (Model Context Protocol). Verbinden Sie KI-Agenten wie Claude, Cursor oder jeden anderen MCP-Client direkt mit Ihrem Browser — ganz ohne npm, ohne Bridge-Prozess, ohne zusätzliche Abhängigkeiten.

### So funktioniert es

1. **Extension installieren** — Laden Sie BrowserMCP als entpackte Erweiterung
2. **Relay starten** — `python3 relay.py` (Python 3 ist auf macOS/Linux vorinstalliert)
3. **AI-Agent verbinden** — MCP-Config einfügen, fertig
4. **Start klicken** — Das BrowserMCP-Icon → Start

### 16 MCP-Tools inklusive

| Tool | Beschreibung |
|---|---|
| `navigate` | Zu einer URL navigieren |
| `screenshot` | Sichtbaren Tab-Bereich erfassen |
| `get_dom` | Vereinfachten Accessibility-Tree extrahieren |
| `click` | Element per CSS-Selector klicken |
| `type_text` | Text in Formularfelder eingeben |
| `extract_text` | Text-Inhalte von Seite/Selektor abrufen |
| `scroll` | Seite hoch/herunter scrollen |
| `get_tabs` | Alle offenen Tabs auflisten |
| `switch_tab` | Zu einem bestimmten Tab wechseln |
| `close_tab` | Tab per ID schließen |
| `evaluate` | JavaScript in der Seite ausführen |
| `get_page_info` | Titel, URL, Viewport-Größe abrufen |
| `fill_form` | Mehrere Formularfelder gleichzeitig ausfüllen |
| `wait` | N Millisekunden warten |
| `press_key` | Tastatureingabe simulieren |
| `get_links` | Alle Links einer Seite extrahieren |

### Warum BrowserMCP?

- **Zero-Setup** — Kein npm, kein Node.js, kein pip. Nur `python3 relay.py`
- **Ihre echte Sitzung** — Nutzt Ihre angemeldeten Tabs, nicht einen sauberen Browser
- **100% lokal** — Alle Verarbeitung passiert auf Ihrem Rechner. Keine Telemetrie, keine Analytics, keine Cloud
- **Minimal & schnell** — ~50KB Extension + 10KB Relay. Keine 300MB+ Browser-Binaries
- **Offener Standard** — Basiert auf dem Model Context Protocol (MCP)

### Datenschutz

BrowserMCP überträgt **keine Daten an externe Server**. Der Relay lauscht ausschließlich auf `localhost`. Sämtliche Browser-Interaktion findet lokal über WebSocket auf `127.0.0.1` statt. Es gibt keine Telemetrie, kein Tracking und keine Analytics.

### Voraussetzungen

- Google Chrome (oder Chromium-basierter Browser mit Manifest V3-Unterstützung)
- Python 3.x (auf macOS/Linux vorinstalliert; Windows: kleiner Download)
- Ein MCP-fähiger AI-Client (Cursor, Claude Desktop, etc.)

### Konfiguration

Fügen Sie dies zu Ihrer MCP-Client-Konfiguration hinzu:

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

### Architektur

```
AI-Agent (Claude/Cursor)
    ↕ stdio (JSON-RPC)
relay.py (Python, zero deps)
    ↕ WebSocket (ws://localhost:9274)
Chrome Extension (offscreen document)
    ↕ chrome.scripting API
Browser Tab
```

### Lizenz

MIT — Open Source

---

**Links:**
- GitHub: https://github.com/Tabtii/browser-mcp
- MCP Protocol: https://modelcontextprotocol.io