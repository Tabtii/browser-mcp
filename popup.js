// ═══════════════════════════════════════════════════════════
// BrowserMCP — Popup Script
// ═══════════════════════════════════════════════════════════

let isRunning = false;

// Check initial status
chrome.runtime.sendMessage({ type: "GET_STATUS" }, (status) => {
  if (status) {
    isRunning = status.running;
    updateUI();
  }
});

// Listen for status updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "CLIENT_CONNECTED") {
    document.getElementById("agentStatus").textContent = "Verbunden ✓";
    document.getElementById("agentStatus").style.color = "#52B788";
  }
  if (msg.type === "CLIENT_DISCONNECTED") {
    document.getElementById("agentStatus").textContent = "Nicht verbunden";
    document.getElementById("agentStatus").style.color = "#6B7B72";
  }
});

function toggleServer() {
  if (isRunning) {
    chrome.runtime.sendMessage({ type: "STOP_SERVER" }, () => {
      isRunning = false;
      updateUI();
    });
  } else {
    chrome.runtime.sendMessage({ type: "START_SERVER" }, () => {
      isRunning = true;
      updateUI();
    });
  }
}

function updateUI() {
  const btn = document.getElementById("startBtn");
  const dot = document.getElementById("statusDot");
  const text = document.getElementById("statusText");
  const ws = document.getElementById("wsStatus");

  if (isRunning) {
    btn.textContent = "Stop";
    btn.className = "btn btn-danger";
    dot.className = "status-dot dot-waiting";
    text.textContent = "Läuft";
    ws.textContent = "ws://localhost:9274";
    ws.style.color = "#E8A33D";
  } else {
    btn.textContent = "Start";
    btn.className = "btn btn-primary";
    dot.className = "status-dot dot-off";
    text.textContent = "Gestoppt";
    ws.textContent = "—";
    ws.style.color = "#6B7B72";
    document.getElementById("agentStatus").textContent = "Nicht verbunden";
    document.getElementById("agentStatus").style.color = "#6B7B72";
  }
}

function copyConfig() {
  navigator.clipboard.writeText("python3 relay.py");
  flashCopied("configText");
}

function copyJson() {
  const config = JSON.stringify({
    mcpServers: {
      "browser-mcp": {
        command: "python3",
        args: ["relay.py"]
      }
    }
  }, null, 2);
  navigator.clipboard.writeText(config);
  flashCopied("jsonConfig");
}

function flashCopied(id) {
  const el = document.getElementById(id);
  const original = el.style.background;
  el.style.background = "#2D6A4F";
  setTimeout(() => { el.style.background = original; }, 500);
}

// ═══════════════════════════════════════════════════════════
// Event Listeners (CSP-safe — no inline handlers)
// ═══════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("startBtn");
  if (startBtn) startBtn.addEventListener("click", toggleServer);

  const configText = document.getElementById("configText");
  if (configText) configText.addEventListener("click", copyConfig);

  const jsonConfig = document.getElementById("jsonConfig");
  if (jsonConfig) jsonConfig.addEventListener("click", copyJson);

  // ─── Pro License UI ───
  const activateBtn = document.getElementById("activateBtn");
  const deactivateBtn = document.getElementById("deactivateBtn");
  const licenseInput = document.getElementById("licenseInput");
  const proBadge = document.getElementById("proBadge");
  const proStatus = document.getElementById("proStatus");

  // Check current license status on popup open
  chrome.runtime.sendMessage({ type: "GET_LICENSE_STATUS" }, (response) => {
    if (response && response.valid) {
      showProActive();
    }
  });

  function showProActive() {
    proBadge.textContent = "Pro ✓";
    proBadge.className = "pro-badge pro-badge-active";
    proStatus.textContent = "All 35 tools unlocked. Thank you for supporting BrowserMCP!";
    proStatus.style.color = "#52B788";
    licenseInput.style.display = "none";
    activateBtn.style.display = "none";
    deactivateBtn.style.display = "block";
  }

  function showProError(msg) {
    proStatus.textContent = msg;
    proStatus.style.color = "#E55934";
  }

  if (activateBtn) {
    activateBtn.addEventListener("click", () => {
      const key = licenseInput.value.trim().toUpperCase();
      if (!key) {
        showProError("Please enter a license key");
        return;
      }
      activateBtn.textContent = "Validating...";
      chrome.runtime.sendMessage({ type: "ACTIVATE_LICENSE", key }, (response) => {
        if (response && response.valid) {
          showProActive();
        } else {
          showProError("Invalid license key. Please check and try again.");
          activateBtn.textContent = "Activate Pro";
        }
      });
    });
  }

  if (deactivateBtn) {
    deactivateBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "DEACTIVATE_LICENSE" }, () => {
        proBadge.textContent = "Free";
        proBadge.className = "pro-badge";
        proStatus.textContent = "Unlock 10 advanced tools: highlight, wait_for_element, get_interactive_elements, click_by_id, type_by_id, click_text, hover, drag_and_drop, handle_dialog, get_markdown";
        proStatus.style.color = "#8A9B91";
        licenseInput.style.display = "block";
        licenseInput.value = "";
        activateBtn.style.display = "block";
        activateBtn.textContent = "Activate Pro";
        deactivateBtn.style.display = "none";
      });
    });
  }
});