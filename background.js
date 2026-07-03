// ═══════════════════════════════════════════════════════════
// BrowserMCP — Background Service Worker
// Zero-setup MCP server running inside the extension
// AI agents connect via WebSocket to localhost:9275
// ═══════════════════════════════════════════════════════════

const MCP_PORT = 9275;
const MCP_VERSION = "0.1.0";
let wsServer = null;
let wsClients = new Set();
let isRunning = false;
let connectedAgent = null;

// ─── MCP Tool Definitions ───
const MCP_TOOLS = [
  {
    name: "navigate",
    description: "Navigate the active tab to a URL",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] }
  },
  {
    name: "screenshot",
    description: "Take a screenshot of the active tab",
    inputSchema: { type: "object", properties: { fullPage: { type: "boolean", default: false } } }
  },
  {
    name: "get_dom",
    description: "Extract the DOM structure of the active tab as text (simplified accessibility tree)",
    inputSchema: { type: "object", properties: { selector: { type: "string", default: "body" } } }
  },
  {
    name: "click",
    description: "Click an element by CSS selector",
    inputSchema: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] }
  },
  {
    name: "type_text",
    description: "Type text into an input field identified by CSS selector",
    inputSchema: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } }, required: ["selector", "text"] }
  },
  {
    name: "extract_text",
    description: "Extract text content from the active tab, optionally from a specific selector",
    inputSchema: { type: "object", properties: { selector: { type: "string", default: "body" } } }
  },
  {
    name: "scroll",
    description: "Scroll the page by a given amount",
    inputSchema: { type: "object", properties: { direction: { type: "string", enum: ["up", "down"], default: "down" }, amount: { type: "number", default: 500 } } }
  },
  {
    name: "get_tabs",
    description: "List all open tabs with their IDs, titles, and URLs",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "switch_tab",
    description: "Switch to a specific tab by its ID",
    inputSchema: { type: "object", properties: { tabId: { type: "number" } }, required: ["tabId"] }
  },
  {
    name: "close_tab",
    description: "Close a tab by its ID",
    inputSchema: { type: "object", properties: { tabId: { type: "number" } }, required: ["tabId"] }
  },
  {
    name: "evaluate",
    description: "Run JavaScript in the active tab and return the result",
    inputSchema: { type: "object", properties: { script: { type: "string" } }, required: ["script"] }
  },
  {
    name: "get_page_info",
    description: "Get metadata about the current page (title, URL, viewport size)",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "fill_form",
    description: "Fill multiple form fields at once. Pass an object of {selector: value} pairs.",
    inputSchema: { type: "object", properties: { fields: { type: "object" } }, required: ["fields"] }
  },
  {
    name: "wait",
    description: "Wait for a specified number of milliseconds",
    inputSchema: { type: "object", properties: { ms: { type: "number", default: 1000 } } }
  },
  {
    name: "press_key",
    description: "Simulate pressing a keyboard key (e.g. 'Enter', 'Tab', 'Escape')",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] }
  },
  {
    name: "get_links",
    description: "Extract all links from the page with their text and href",
    inputSchema: { type: "object", properties: {} }
  },
  // ─── Recording / Playback ───
  {
    name: "start_recording",
    description: "Start recording browser actions (clicks, inputs, navigations) for later playback",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "stop_recording",
    description: "Stop recording and return the recorded action sequence as JSON",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "playback",
    description: "Replay a previously recorded action sequence. Pass the actions array from stop_recording.",
    inputSchema: { type: "object", properties: { actions: { type: "array" }, speed: { type: "number", default: 1 } }, required: ["actions"] }
  },
  // ─── Form Detection ───
  {
    name: "detect_forms",
    description: "Auto-detect all forms on the page with their fields, types, labels, and selectors",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "auto_fill_form",
    description: "Auto-fill a form with AI-generated values. Detects the form and suggests values based on field types/names.",
    inputSchema: { type: "object", properties: { selector: { type: "string", default: "form" }, values: { type: "object" } } }
  },
  // ─── Multi-Tab Workflows ───
  {
    name: "create_tab",
    description: "Create a new tab with an optional URL",
    inputSchema: { type: "object", properties: { url: { type: "string" }, active: { type: "boolean", default: true } } }
  },
  {
    name: "batch_execute",
    description: "Execute multiple tool calls in sequence on a specific tab. Pass an array of {tool, args} objects.",
    inputSchema: { type: "object", properties: { tabId: { type: "number" }, steps: { type: "array" } }, required: ["steps"] }
  },
  {
    name: "get_console_logs",
    description: "Capture console logs from the active tab (errors, warnings, logs)",
    inputSchema: { type: "object", properties: { level: { type: "string", enum: ["error", "warn", "log", "all"], default: "all" } } }
  },
  {
    name: "get_network_requests",
    description: "Capture recent network requests from the active tab (URL, method, status, type)",
    inputSchema: { type: "object", properties: { filter: { type: "string", default: "" } } }
  }
];

// ─── Recording State ───
let recordingState = { isRecording: false, actions: [], recordingTabId: null };

// ─── Network/Console Capture State ───
let consoleLogs = [];
let networkRequests = [];

// ─── MCP Protocol Handler ───
async function handleMcpRequest(message) {
  const { jsonrpc, id, method, params } = message;

  if (jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } };
  }

  try {
    let result;

    switch (method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: { listChanged: false }
          },
          serverInfo: { name: "browser-mcp", version: MCP_VERSION }
        };
        break;

      case "tools/list":
        result = { tools: MCP_TOOLS };
        break;

      case "tools/call":
        result = await executeTool(params.name, params.arguments || {});
        break;

      case "notifications/initialized":
        return null; // No response for notifications

      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    }

    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    console.error(`[BrowserMCP] Error handling ${method}:`, error);
    return {
      jsonrpc: "2.0", id,
      error: { code: -32603, message: error.message || "Internal error" }
    };
  }
}

// ─── Tool Execution ───
async function executeTool(toolName, args) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab && !["get_tabs", "switch_tab", "close_tab"].includes(toolName)) {
    throw new Error("No active tab found");
  }

  switch (toolName) {
    case "navigate": {
      await chrome.tabs.update(tab.id, { url: args.url });
      await waitForTabLoad(tab.id);
      return { content: [{ type: "text", text: `Navigated to ${args.url}` }] };
    }

    case "screenshot": {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      return {
        content: [
          { type: "text", text: "Screenshot captured" },
          { type: "image", data: dataUrl.split(",")[1], mimeType: "image/png" }
        ]
      };
    }

    case "get_dom": {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (sel) => {
          const element = sel === "body" ? document.body : document.querySelector(sel);
          if (!element) return "Element not found";
          return buildAccessibleTree(element);
          function buildAccessibleTree(el, depth = 0) {
            if (!el || el.nodeType !== 1) return "";
            const tag = el.tagName.toLowerCase();
            const text = (el.textContent || "").trim().substring(0, 80);
            const role = el.getAttribute("role") || "";
            const aria = el.getAttribute("aria-label") || "";
            const href = el.getAttribute("href") || "";
            const name = el.getAttribute("name") || "";
            const id = el.id || "";
            const cls = el.className || "";
            let indent = "  ".repeat(depth);
            let line = `${indent}<${tag}`;
            if (id) line += ` #${id}`;
            if (cls) line += ` .${String(cls).substring(0, 40)}`;
            if (role) line += ` [${role}]`;
            if (aria) line += ` "${aria}"`;
            if (href) line += ` href="${href.substring(0, 60)}"`;
            if (name) line += ` name="${name}"`;
            if (text && text.length < 80 && el.children.length === 0) line += `>${text}</${tag}>`;
            else line += `>`;
            let result = line + "\n";
            for (const child of el.children) {
              if (depth < 5) result += buildAccessibleTree(child, depth + 1);
            }
            return result;
          }
        },
        args: [args.selector || "body"]
      });
      return { content: [{ type: "text", text: results[0]?.result || "Empty" }] };
    }

    case "click": {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (sel) => {
          const el = document.querySelector(sel);
          if (!el) return `Element not found: ${sel}`;
          el.click();
          return `Clicked: ${sel}`;
        },
        args: [args.selector]
      });
      return { content: [{ type: "text", text: results[0]?.result }] };
    }

    case "type_text": {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (sel, text) => {
          const el = document.querySelector(sel);
          if (!el) return `Element not found: ${sel}`;
          el.focus();
          el.value = text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return `Typed "${text}" into ${sel}`;
        },
        args: [args.selector, args.text]
      });
      return { content: [{ type: "text", text: results[0]?.result }] };
    }

    case "extract_text": {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (sel) => {
          const el = sel === "body" || !sel ? document.body : document.querySelector(sel);
          if (!el) return "Element not found";
          return (el.innerText || "").substring(0, 10000);
        },
        args: [args.selector || "body"]
      });
      return { content: [{ type: "text", text: results[0]?.result || "Empty" }] };
    }

    case "scroll": {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (dir, amt) => {
          window.scrollBy({ top: dir === "up" ? -amt : amt, behavior: "smooth" });
        },
        args: [args.direction || "down", args.amount || 500]
      });
      return { content: [{ type: "text", text: `Scrolled ${args.direction || "down"} by ${args.amount || 500}px` }] };
    }

    case "get_tabs": {
      const tabs = await chrome.tabs.query({});
      const tabList = tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active }));
      return { content: [{ type: "text", text: JSON.stringify(tabList, null, 2) }] };
    }

    case "switch_tab": {
      await chrome.tabs.update(args.tabId, { active: true });
      return { content: [{ type: "text", text: `Switched to tab ${args.tabId}` }] };
    }

    case "close_tab": {
      await chrome.tabs.remove(args.tabId);
      return { content: [{ type: "text", text: `Closed tab ${args.tabId}` }] };
    }

    case "evaluate": {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (script) => { try { return String(eval(script)); } catch(e) { return `Error: ${e.message}`; } },
        args: [args.script]
      });
      return { content: [{ type: "text", text: results[0]?.result || "undefined" }] };
    }

    case "get_page_info": {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          title: document.title,
          url: window.location.href,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scroll: { x: window.scrollX, y: window.scrollY }
        })
      });
      return { content: [{ type: "text", text: JSON.stringify(results[0]?.result, null, 2) }] };
    }

    case "fill_form": {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (fields) => {
          const results = [];
          for (const [sel, val] of Object.entries(fields)) {
            const el = document.querySelector(sel);
            if (!el) { results.push(`${sel}: not found`); continue; }
            el.focus();
            el.value = val;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            results.push(`${sel}: filled`);
          }
          return results.join("\n");
        },
        args: [args.fields]
      });
      return { content: [{ type: "text", text: results[0]?.result }] };
    }

    case "wait": {
      await new Promise(r => setTimeout(r, args.ms || 1000));
      return { content: [{ type: "text", text: `Waited ${args.ms || 1000}ms` }] };
    }

    case "press_key": {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (key) => {
          document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
          document.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
          return `Pressed ${key}`;
        },
        args: [args.key]
      });
      return { content: [{ type: "text", text: results[0]?.result }] };
    }

    case "get_links": {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return Array.from(document.querySelectorAll("a[href]")).slice(0, 100).map(a => ({
            text: (a.textContent || "").trim().substring(0, 80),
            href: a.href
          }));
        }
      });
      return { content: [{ type: "text", text: JSON.stringify(results[0]?.result, null, 2) }] };
    }

    // ─── Recording / Playback ───
    case "start_recording": {
      recordingState = { isRecording: true, actions: [], recordingTabId: tab.id };
      // Inject recording listener
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (window.__browserMcpRecording) return;
          window.__browserMcpRecording = true;
          window.__browserMcpActions = [];
          document.addEventListener("click", (e) => {
            const el = e.target;
            const selector = el.id ? `#${el.id}` : el.className ? `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}` : el.tagName.toLowerCase();
            window.__browserMcpActions.push({ type: "click", selector, timestamp: Date.now() });
          }, true);
          document.addEventListener("input", (e) => {
            const el = e.target;
            if (!el.value) return;
            const selector = el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : el.tagName.toLowerCase();
            window.__browserMcpActions.push({ type: "type", selector, text: el.value, timestamp: Date.now() });
          }, true);
        }
      });
      return { content: [{ type: "text", text: "Recording started. Interact with the page — actions are being captured." }] };
    }

    case "stop_recording": {
      if (!recordingState.isRecording) {
        return { content: [{ type: "text", text: "Not recording." }] };
      }
      // Collect recorded actions from the page
      const results = await chrome.scripting.executeScript({
        target: { tabId: recordingState.recordingTabId || tab.id },
        func: () => {
          const actions = window.__browserMcpActions || [];
          window.__browserMcpRecording = false;
          window.__browserMcpActions = [];
          return actions;
        }
      });
      const actions = results[0]?.result || [];
      recordingState.isRecording = false;
      return { content: [{ type: "text", text: JSON.stringify({ recorded: actions.length, actions }, null, 2) }] };
    }

    case "playback": {
      const actions = args.actions || [];
      const speed = args.speed || 1;
      for (const action of actions) {
        const delay = 500 / speed;
        await new Promise(r => setTimeout(r, delay));
        if (action.type === "click") {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (sel) => { const el = document.querySelector(sel); if (el) el.click(); },
            args: [action.selector]
          });
        } else if (action.type === "type") {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (sel, text) => {
              const el = document.querySelector(sel);
              if (el) { el.focus(); el.value = text; el.dispatchEvent(new Event("input", { bubbles: true })); }
            },
            args: [action.selector, action.text]
          });
        } else if (action.type === "navigate") {
          await chrome.tabs.update(tab.id, { url: action.url });
          await waitForTabLoad(tab.id);
        }
      }
      return { content: [{ type: "text", text: `Playback complete: ${actions.length} actions executed.` }] };
    }

    // ─── Form Detection ───
    case "detect_forms": {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const forms = Array.from(document.querySelectorAll("form"));
          return forms.map((form, idx) => {
            const fields = Array.from(form.querySelectorAll("input, select, textarea")).map(el => ({
              tag: el.tagName.toLowerCase(),
              type: el.type || "",
              name: el.name || "",
              id: el.id || "",
              label: el.getAttribute("aria-label") || (el.labels?.[0]?.textContent?.trim() || ""),
              required: el.required,
              placeholder: el.placeholder || "",
              selector: el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : `${el.tagName.toLowerCase()}:nth-of-type(1)`,
              value: el.value || ""
            }));
            return { formIndex: idx, action: form.action || "", method: form.method || "get", fieldCount: fields.length, fields };
          });
        }
      });
      return { content: [{ type: "text", text: JSON.stringify(results[0]?.result || [], null, 2) }] };
    }

    case "auto_fill_form": {
      const selector = args.selector || "form";
      const values = args.values || {};
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (sel, vals) => {
          const form = document.querySelector(sel);
          if (!form) return `Form not found: ${sel}`;
          const fields = Array.from(form.querySelectorAll("input, select, textarea"));
          const filled = [];
          for (const el of fields) {
            const key = el.id || el.name || el.type;
            const val = vals[key] || vals[el.name] || vals[el.id] || "";
            if (val) {
              el.focus();
              el.value = val;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              filled.push(`${key}="${val}"`);
            }
          }
          return `Filled ${filled.length} fields: ${filled.join(", ")}`;
        },
        args: [selector, values]
      });
      return { content: [{ type: "text", text: results[0]?.result }] };
    }

    // ─── Multi-Tab Workflows ───
    case "create_tab": {
      const newTab = await chrome.tabs.create({ url: args.url || "about:blank", active: args.active !== false });
      if (args.url) await waitForTabLoad(newTab.id);
      return { content: [{ type: "text", text: `Created tab ${newTab.id} with URL: ${args.url || "about:blank"}` }] };
    }

    case "batch_execute": {
      const steps = args.steps || [];
      const targetTabId = args.tabId || tab.id;
      const results = [];
      for (const step of steps) {
        try {
          const stepResult = await executeTool(step.tool, step.args || {});
          results.push({ tool: step.tool, success: true, result: stepResult });
        } catch (e) {
          results.push({ tool: step.tool, success: false, error: e.message });
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }

    case "get_console_logs": {
      const level = args.level || "all";
      // Use chrome.debugger to capture console logs
      // For simplicity, we inject a script that captures console output
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (lvl) => {
          if (!window.__browserMcpLogs) {
            window.__browserMcpLogs = [];
            const origLog = console.log;
            const origWarn = console.warn;
            const origError = console.error;
            console.log = (...args) => { window.__browserMcpLogs.push({ level: "log", args: args.map(String), time: Date.now() }); origLog(...args); };
            console.warn = (...args) => { window.__browserMcpLogs.push({ level: "warn", args: args.map(String), time: Date.now() }); origWarn(...args); };
            console.error = (...args) => { window.__browserMcpLogs.push({ level: "error", args: args.map(String), time: Date.now() }); origError(...args); };
          }
          window.onerror = (msg, url, line, col, err) => {
            window.__browserMcpLogs.push({ level: "error", args: [`${msg} at ${url}:${line}:${col}`], time: Date.now() });
          };
          const logs = window.__browserMcpLogs || [];
          return lvl === "all" ? logs : logs.filter(l => l.level === lvl);
        },
        args: [level]
      });
      return { content: [{ type: "text", text: JSON.stringify(results[0]?.result || [], null, 2) }] };
    }

    case "get_network_requests": {
      const filterStr = args.filter || "";
      // Use the debugger API to capture network requests
      // For a lightweight approach, we use Performance API
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (filterStr) => {
          const entries = performance.getEntriesByType("resource");
          const requests = entries.map(e => ({
            url: e.name,
            type: e.initiatorType,
            duration: Math.round(e.duration),
            size: e.transferSize || 0
          })).filter(r => !filterStr || r.url.includes(filterStr));
          return requests.slice(-50);
        },
        args: [filterStr]
      });
      return { content: [{ type: "text", text: JSON.stringify(results[0]?.result || [], null, 2) }] };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ─── Helper: Wait for tab load ───
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, change) => {
      if (id === tabId && change.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 10000);
  });
}

// ─── WebSocket MCP Server (via offscreen document) ───
async function startServer() {
  if (isRunning) return;

  // Use chrome.offscreen API to create a WebSocket server
  // Since service workers can't open WebSocket servers directly,
  // we use an offscreen document
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WEB_SOCKETS"],
      justification: "MCP WebSocket server for AI browser control"
    });
    isRunning = true;

    chrome.runtime.sendMessage({ type: "START_MCP_SERVER", port: MCP_PORT });

    chrome.storage.local.set({ mcpRunning: true, mcpPort: MCP_PORT });
  } catch (e) {
    // If already exists, just restart
    if (e.message.includes("existing")) {
      chrome.runtime.sendMessage({ type: "START_MCP_SERVER", port: MCP_PORT });
      isRunning = true;
      chrome.storage.local.set({ mcpRunning: true, mcpPort: MCP_PORT });
    } else {
      console.error("[BrowserMCP] Failed to start:", e);
    }
  }
}

async function stopServer() {
  if (!isRunning) return;

  chrome.runtime.sendMessage({ type: "STOP_MCP_SERVER" });

  try {
    const clients = await chrome.offscreen.hasDocument();
    if (clients) await chrome.offscreen.closeDocument();
  } catch (e) {}

  isRunning = false;
  connectedAgent = null;
  chrome.storage.local.set({ mcpRunning: false, mcpPort: null, agentConnected: false });
}

// ─── Message routing: offscreen ↔ background ───
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "MCP_REQUEST") {
    handleMcpRequest(msg.data).then(response => {
      if (response) {
        sendResponse(response);
      }
    }).catch(err => {
      sendResponse({ jsonrpc: "2.0", id: msg.data?.id, error: { code: -32603, message: err.message } });
    });
    return true; // async
  }

  if (msg.type === "CLIENT_CONNECTED") {
    connectedAgent = msg.clientId;
    wsClients.add(msg.clientId);
    chrome.storage.local.set({ agentConnected: true });
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#52B788" });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "CLIENT_DISCONNECTED") {
    wsClients.delete(msg.clientId);
    if (wsClients.size === 0) {
      connectedAgent = null;
      chrome.storage.local.set({ agentConnected: false });
      chrome.action.setBadgeText({ text: isRunning ? "RDY" : "" });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "GET_STATUS") {
    sendResponse({ running: isRunning, port: MCP_PORT, clients: wsClients.size });
    return false;
  }

  if (msg.type === "START_SERVER") {
    startServer().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "STOP_SERVER") {
    stopServer().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ─── Extension install ───
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ mcpRunning: false, mcpPort: null, agentConnected: false, autoStart: false });
  console.log("[BrowserMCP] Extension installed. MCP server ready to start.");
});