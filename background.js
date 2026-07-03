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
  }
];

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