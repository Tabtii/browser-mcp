# Chrome Web Store Permission Begründungen

Jede Begründung erklärt warum BrowserMCP die jeweilige Permission braucht. Max 4000 Zeichen pro Feld.

---

## activeTab
"Wenn der Nutzer ein Tool ausführt, greift die Extension nur auf den aktuell aktiven Tab zu und nur für die Dauer der Aktion. So bekommt der Nutzer volle Kontrolle: er entscheidet welcher Tab gesteuert wird, und kein anderer Tab wird gelesen oder verändert."

## tabs
"Wird benötigt um Tabs aufzulisten, zwischen ihnen zu wechseln, neue Tabs zu erstellen und Tabs zu schließen — das sind MCP-Tools wie `get_tabs`, `switch_tab`, `create_tab` und `close_tab`. Außerdem liefert die Permission die URL und den Titel des aktiven Tabs für `get_page_info` und Navigation. Es werden keine Inhalte anderer Tabs gelesen."

## scripting
"Wird benutzt um JavaScript in Webseiten auszuführen, damit MCP-Tools wie `click`, `type_text`, `extract_text`, `get_dom`, `get_markdown`, `wait_for_element`, `highlight` und `evaluate` funktionieren. Das Skript wird nur per explizitem Tool-Call vom Nutzer gestartet, niemals automatisch."

## storage
"Speichert ausschließlich die Nutzer-Präferenzen lokal: Relay-Status (AN/AUS), gespeicherte MCP-Portnummer, Pro-Lizenzschlüssel und Aufnahme-Sessions für die `start_recording` / `playback` Tools. Keine Telemetrie, keine Nutzungsdaten, keine externen Server."

## debugger
"Das `screenshot` Tool nutzt die Chrome DevTools Protocol API über `chrome.debugger` um Pixel aus dem Tab zu lesen — das ist der einzige Weg in einer reinen MV3-Extension verlässlich Screenshots zu bekommen, weil `chrome.tabs.captureVisibleTab` an CSP-sensible Sites scheitert. Die Debugger-Session wird nach jedem Screenshot sofort wieder getrennt."

## offscreen
"Die Extension braucht eine persistente WebSocket-Verbindung zum lokalen Relay-Server. Service Worker in MV3 dürfen keine WebSockets halten, also wird ein Offscreen-Dokument mit Reason `WORKERS` erstellt. Nur sichtbar während der MCP-Server läuft (Nutzer klickt 'Start' im Popup)."

## host_permissions: <all_urls>
"BrowserMCP ist ein allgemeines Browser-Control-Tool für AI-Agents. Der Nutzer gibt über das MCP-Protokoll explizit eine URL an — die Extension muss auf jeder beliebigen Seite Inhalte lesen und manipulieren können, sonst wäre das Tool auf eine Handvoll Domains beschränkt und nutzlos. Es werden keine Daten an externe Server gesendet, keine Inhalte protokolliert, kein Verhalten außerhalb der Tool-Calls."

## remote code
"Die Extension nutzt `new Function(...)` im `evaluate` Tool, um vom AI-Agent geschicktes JavaScript in der aktiven Webseite auszuführen. Das ist die einzige Möglichkeit, ein generisches Code-Ausführungs-Tool ohne eigene Code-Compilation bereitzustellen. Eingaben werden 1:1 vom MCP-Request durchgereicht — der Nutzer entscheidet explizit wann `evaluate` aufgerufen wird. Es wird kein Code von einem externen Server geladen; das `connect-src` in der CSP erlaubt ausschließlich `localhost` / `127.0.0.1`."

## Single Purpose
"BrowserMCP hat genau einen Zweck: dem Nutzer ermöglichen, seinen Chrome-Browser über das Model Context Protocol (MCP) von einem lokalen AI-Agent aus der Ferne zu steuern. Alle 35 Tools — Navigation, Klicks, Texteingabe, Screenshots, DOM-Extraktion, Form-Ausfüllung, Tab-Management, Recording — dienen ausschließlich diesem Zweck. Es gibt keine zusätzlichen Features, keine Tracker, keine Werbung, keine Analyse."

---

## Datenschutz/Policies
- **Datennutzung:** "Diese Extension sammelt, nutzt oder überträgt keine Nutzerdaten an Dritte. Alle Operationen laufen lokal zwischen Chrome, dem BrowserMCP-Service-Worker und dem optionalen lokalen Relay-Server auf `127.0.0.1`. Es gibt kein Analytics, kein Tracking, keine externen API-Calls."
- **Kontakt-Email des Publishers:** `torbi95@gmail.com`
