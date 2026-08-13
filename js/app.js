(function () {
  "use strict";
  var IDE = window.LlamaIDE;
  function syncRaw() {
    var area = document.getElementById("raw-editor"); area.value = IDE.state.rawText || IDE.Json.pretty(IDE.state.document);
    IDE.Json.highlight(document.getElementById("raw-highlight"), area.value);
  }
  function captureResponse(response) {
    if (response && typeof response === "object") {
      IDE.state.lastResponse = JSON.parse(JSON.stringify(response));
      IDE.state.responseOpen = true;
      IDE.Response.render();
    }
    if (!Array.isArray(IDE.state.document.messages)) throw new Error("Cannot capture the response because messages is not an array.");
    if (!response || !Array.isArray(response.choices)) throw new Error("The server response has no choices array. Nothing was added to the document.");
    var messages = response.choices.filter(function (choice) { return choice && choice.message && typeof choice.message === "object"; }).map(function (choice) { return JSON.parse(JSON.stringify(choice.message)); });
    if (!messages.length) throw new Error("The server response contains no choice.message object. Nothing was added to the document.");
    Array.prototype.push.apply(IDE.state.document.messages, messages);
    IDE.state.rawText = IDE.Json.pretty(IDE.state.document); IDE.setDirty(true); IDE.Rendered.render(); syncRaw();
    return messages.length;
  }
  function activateView(name) {
    if (IDE.state.activeView === "raw" && name !== "raw") {
      try { IDE.state.document = IDE.Json.parse(document.getElementById("raw-editor").value); IDE.state.rawText = document.getElementById("raw-editor").value; IDE.Rendered.render(); IDE.App.notice(""); }
      catch (error) { IDE.App.notice("Raw request cannot be applied: " + error.message); return; }
    }
    IDE.state.activeView = name; document.querySelectorAll(".view-tabs button").forEach(function (b) { b.classList.toggle("active", b.dataset.view === name); }); document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("active", v.id === name + "-view"); });
    if (name === "raw") syncRaw(); if (name === "prompt") IDE.Server.applyTemplate();
  }
  IDE.App = {
    notice: function (message) { var box = document.getElementById("notice"); box.textContent = message || ""; box.classList.toggle("hidden", !message); },
    connection: function (online, label) { var dot = document.getElementById("server-dot"); dot.className = "status-dot " + (online ? "online" : "error"); document.getElementById("server-label").textContent = label; },
    refreshAll: function () { document.getElementById("file-name").textContent = IDE.state.fileName; syncRaw(); IDE.Rendered.render(); IDE.Response.render(); },
    safe: async function (work) { try { await work(); IDE.App.notice(""); } catch (error) { if (error && error.name !== "AbortError") IDE.App.notice(error.message || String(error)); } }
  };
  document.querySelectorAll("[data-menu]").forEach(function (button) { button.addEventListener("click", function (event) { event.stopPropagation(); var menu = document.getElementById(button.dataset.menu); var open = !menu.classList.contains("open"); document.querySelectorAll(".menu").forEach(function (m) { m.classList.remove("open"); }); menu.classList.toggle("open", open); button.classList.toggle("open", open); }); });
  document.addEventListener("click", function () { document.querySelectorAll(".menu").forEach(function (m) { m.classList.remove("open"); }); });
  document.querySelectorAll(".view-tabs button").forEach(function (b) { b.addEventListener("click", function () { activateView(b.dataset.view); }); });
  document.getElementById("response-toggle").addEventListener("click", function () { IDE.state.responseOpen = !IDE.state.responseOpen; IDE.Response.render(); });
  document.querySelectorAll("[data-action]").forEach(function (b) { b.addEventListener("click", function () { var action = b.dataset.action; if (action === "settings") { document.getElementById("base-url").value = IDE.state.settings.baseUrl; IDE.MCP.open(); } else if (action === "new") IDE.Files.newFile(); else if (action === "open") IDE.App.safe(IDE.Files.open); else if (action === "save") IDE.App.safe(IDE.Files.save); else if (action === "save-as") IDE.App.safe(IDE.Files.saveAs); }); });
  document.getElementById("settings-form").addEventListener("submit", function (event) { event.preventDefault(); IDE.state.settings.baseUrl = document.getElementById("base-url").value.trim(); IDE.MCP.captureForm(); localStorage.setItem("llamaIde.baseUrl", IDE.state.settings.baseUrl); document.getElementById("settings-dialog").close(); IDE.Server.loadModel(); IDE.Server.loadSlots(); });
  document.getElementById("mcp-connect").addEventListener("click", function () { IDE.App.safe(IDE.MCP.connect); });
  document.querySelectorAll("[data-close-settings]").forEach(function (button) { button.addEventListener("click", function () { document.getElementById("settings-dialog").close(); }); });
  document.getElementById("file-input").addEventListener("change", function () { if (this.files[0]) IDE.App.safe(function () { return IDE.Files.openInput(this.files[0]); }.bind(this)); this.value = ""; });
  document.getElementById("raw-editor").addEventListener("input", function () { IDE.state.rawText = this.value; IDE.Json.highlight(document.getElementById("raw-highlight"), this.value); IDE.setDirty(true); try { IDE.Json.parse(this.value); document.getElementById("json-status").textContent = "Valid JSON"; } catch (_) { document.getElementById("json-status").textContent = "Invalid JSON"; } });
  document.getElementById("raw-editor").addEventListener("scroll", function () { var highlight = document.getElementById("raw-highlight"); highlight.scrollTop = this.scrollTop; highlight.scrollLeft = this.scrollLeft; });
  document.getElementById("format-button").addEventListener("click", function () { IDE.App.safe(async function () { if (IDE.state.activeView === "raw") { IDE.state.document = IDE.Json.parse(document.getElementById("raw-editor").value); } IDE.state.rawText = IDE.Json.pretty(IDE.state.document); syncRaw(); IDE.setDirty(true); }); });
  document.getElementById("refresh-prompt").addEventListener("click", IDE.Server.applyTemplate); document.getElementById("refresh-model").addEventListener("click", IDE.Server.loadModel); document.getElementById("refresh-slots").addEventListener("click", IDE.Server.loadSlots);
  document.getElementById("run-button").addEventListener("click", function () { IDE.App.safe(async function () {
    if (IDE.state.activeView === "raw") { IDE.state.document = IDE.Json.parse(document.getElementById("raw-editor").value); IDE.state.rawText = document.getElementById("raw-editor").value; }
    var count = 0, toolCount = 0;
    var turnLimit = IDE.state.settings.toolLoopLimit;
    for (var turn = 0; turn < turnLimit; turn += 1) {
      var result = await IDE.Server.run(); count += captureResponse(result);
      var message = result && result.choices && result.choices[0] && result.choices[0].message;
      var calls = IDE.MCP.toolCalls(message);
      if (!calls.length) break;
      for (var i = 0; i < calls.length; i += 1) {
        var toolResult = await IDE.MCP.call(calls[i]);
        IDE.state.document.messages.push(IDE.MCP.toolMessage(calls[i], toolResult)); toolCount += 1;
      }
      IDE.state.rawText = IDE.Json.pretty(IDE.state.document); IDE.setDirty(true); IDE.Rendered.render(); syncRaw();
      if (turn === turnLimit - 1) throw new Error("Stopped after " + turnLimit + " model/tool turns. Change the limit in Settings if needed.");
    }
    activateView("rendered");
    IDE.App.notice("Captured " + count + " assistant message" + (count === 1 ? "" : "s") + (toolCount ? " and executed " + toolCount + " MCP tool call" + (toolCount === 1 ? "" : "s") : "") + ". Response metadata is shown below for this session only.");
  }); });
  document.addEventListener("keydown", function (event) { if (!(event.ctrlKey || event.metaKey)) return; if (event.key.toLowerCase() === "s") { event.preventDefault(); IDE.App.safe(IDE.Files.save); } if (event.key.toLowerCase() === "o") { event.preventDefault(); IDE.App.safe(IDE.Files.open); } if (event.key.toLowerCase() === "n") { event.preventDefault(); IDE.Files.newFile(); } });
  window.addEventListener("beforeunload", function (event) { if (IDE.state.dirty) { event.preventDefault(); event.returnValue = ""; } });
  IDE.state.rawText = IDE.Json.pretty(IDE.state.document); IDE.App.refreshAll();
})();
