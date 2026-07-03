# Berechtigungs-Begründung — BrowserMCP

## Erforderliche Berechtigungen

| Berechtigung | Begründung |
|---|---|
| `activeTab` | Ermöglicht der Extension, auf den aktiven Tab zuzugreifen. Der AI-Agent muss den aktuellen Tab lesen und steuern können (Screenshots, DOM-Extraktion, Klicks, Texteingabe). |
| `tabs` | Der AI-Agent kann Tabs auflisten (`get_tabs`), zwischen Tabs wechseln (`switch_tab`) und Tabs schließen (`close_tab`). Diese Funktionen sind Teil der 16 MCP-Tools. |
| `scripting` | Die `chrome.scripting` API wird verwendet, um JavaScript in Tabs auszuführen — erforderlich für: Klicks simulieren, Text eingeben, DOM extrahieren, Formulare ausfüllen, Links extrahieren, scrollen, Tastendrücke simulieren und JavaScript auszuferten. |
| `storage` | Speichert den lokalen Extension-Status (Server läuft/gestoppt, WebSocket-Port, AI-Agent verbunden). Wird ausschließlich für die UI-Statusanzeige verwendet. Keine Synchronisation, keine Cloud. |
| `debugger` | Wird für die `chrome.debugger` API benötigt, um erweiterte Browser-Kontrollfunktionen bereitzustellen (z.B. präzise Maus-Klicks, Scroll-Events). |
| `notifications` | Zeigt dem Nutzer Status-Benachrichtigungen (z.B. "AI-Agent verbunden", "Server gestartet"). Keine Push-Benachrichtigungen, keine Werbung. |
| `offscreen` | Erstellt ein Offscreen-Dokument, in dem der WebSocket-Server läuft. Service Worker in Manifest V3 können keinen WebSocket-Server hosten — das Offscreen-Dokument ist der Workaround für diese Einschränkung. |

## Host-Berechtigungen

| Berechtigung | Begründung |
|---|---|
| `<all_urls>` | Der AI-Agent muss zu beliebigen URLs navigieren können und auf beliebige Seiteninhalte zugreifen (DOM-Extraktion, Text-Extraktion, Klicks, Formulare). Die Einschränkung auf bestimmte URLs würde den Kernzweck der Extension (universelle Browser-Kontrolle) verunmöglichen. |

## Nicht verwendete Berechtigungen

BrowserMCP verwendet **nicht**:

- `cookies` — Kein Cookie-Zugriff
- `webRequest` — Keine Anfrage-Modifikation
- `history` — Kein Verlaufszugriff
- `bookmarks` — Kein Lesezeichen-Zugriff
- `downloads` — Kein Download-Zugriff
- `clipboardWrite` — Nur über `navigator.clipboard` im Popup (keine separate Berechtigung)