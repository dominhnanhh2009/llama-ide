(function () {
  "use strict";
  var IDE = window.LlamaIDE;
  function syncRaw() {
    var area = document.getElementById("raw-editor"); area.value = IDE.state.rawText || IDE.Json.pretty(IDE.state.document);
    IDE.Json.highlight(document.getElementById("raw-highlight"), area.value);
  }
  var streamRenderTimer = null;
  function scheduleStreamRender() {
    if (streamRenderTimer !== null) return;
    streamRenderTimer = setTimeout(function () {
      streamRenderTimer = null; IDE.state.rawText = IDE.Json.pretty(IDE.state.document); IDE.Rendered.render(); syncRaw();
    }, 250);
  }
  function captureResponse(response, streamedMessage) {
    if (response && typeof response === "object") {
      IDE.state.lastResponse = JSON.parse(JSON.stringify(response));
      IDE.Response.render();
    }
    if (!Array.isArray(IDE.state.document.messages)) throw new Error("Cannot capture the response because messages is not an array.");
    if (!response || !Array.isArray(response.choices)) throw new Error("The server response has no choices array. Nothing was added to the document.");
    var messages = response.choices.filter(function (choice) { return choice && choice.message && typeof choice.message === "object"; }).map(function (choice) { return JSON.parse(JSON.stringify(choice.message)); });
    if (!messages.length) throw new Error("The server response contains no choice.message object. Nothing was added to the document.");
    var streamedIndex = streamedMessage ? IDE.state.document.messages.indexOf(streamedMessage) : -1;
    if (streamedIndex !== -1) IDE.state.document.messages.splice.apply(IDE.state.document.messages, [streamedIndex, 1].concat(messages));
    else Array.prototype.push.apply(IDE.state.document.messages, messages);
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
  document.querySelectorAll("[data-side-view]").forEach(function (b) { b.addEventListener("click", function () {
    document.querySelectorAll(".side-tabs button").forEach(function (button) { button.classList.toggle("active", button === b); });
    document.querySelectorAll(".side-view").forEach(function (view) { view.classList.toggle("active", view.id === b.dataset.sideView + "-side-view"); });
  }); });
  document.querySelectorAll("[data-runtime-view]").forEach(function (b) { b.addEventListener("click", function () {
    document.querySelectorAll("[data-runtime-view]").forEach(function (button) { button.classList.toggle("active", button === b); });
    document.querySelectorAll(".runtime-view").forEach(function (view) { view.classList.toggle("active", view.id === b.dataset.runtimeView + "-runtime-view"); });
    if (b.dataset.runtimeView === "models") IDE.Server.loadModels();
  }); });
  document.getElementById("response-toggle").addEventListener("click", function () { IDE.state.responseOpen = !IDE.state.responseOpen; IDE.Response.render(); });
  document.querySelectorAll("[data-action]").forEach(function (b) { b.addEventListener("click", function () { var action = b.dataset.action; if (action === "settings") { document.getElementById("base-url").value = IDE.state.settings.baseUrl; IDE.MCP.open(); } else if (action === "new") IDE.Files.newFile(); else if (action === "open") IDE.App.safe(IDE.Files.open); else if (action === "save") IDE.App.safe(IDE.Files.save); else if (action === "save-as") IDE.App.safe(IDE.Files.saveAs); }); });
  document.getElementById("settings-form").addEventListener("submit", function (event) { event.preventDefault(); IDE.state.settings.baseUrl = document.getElementById("base-url").value.trim(); IDE.MCP.captureForm(); localStorage.setItem("llamaIde.baseUrl", IDE.state.settings.baseUrl); document.getElementById("settings-dialog").close(); IDE.Server.loadModels(); IDE.Server.loadSlots(); });
  document.getElementById("mcp-connect").addEventListener("click", function () { IDE.App.safe(IDE.MCP.connect); });
  document.getElementById("connect-server-button").addEventListener("click", function () { IDE.App.safe(IDE.Server.connect); });
  document.getElementById("use-mcp-button").addEventListener("click", function () {
    var button = document.getElementById("use-mcp-button");
    IDE.App.safe(function () { return IDE.MCP.connect({ url: IDE.state.settings.mcpUrl, button: button }); });
  });
  document.getElementById("markdown-button").addEventListener("click", function () {
    var button = document.getElementById("markdown-button"); IDE.state.renderMarkdown = !IDE.state.renderMarkdown;
    button.classList.toggle("active", IDE.state.renderMarkdown); button.setAttribute("aria-pressed", String(IDE.state.renderMarkdown));
    button.title = IDE.state.renderMarkdown ? "Disable Markdown rendering" : "Enable Markdown rendering";
    button.setAttribute("aria-label", button.title); button.querySelector(".action-label").textContent = IDE.state.renderMarkdown ? "Markdown on" : "Markdown off";
    IDE.Rendered.render();
  });
  document.querySelectorAll("[data-close-settings]").forEach(function (button) { button.addEventListener("click", function () { document.getElementById("settings-dialog").close(); }); });
  document.getElementById("file-input").addEventListener("change", function () { if (this.files[0]) IDE.App.safe(function () { return IDE.Files.openInput(this.files[0]); }.bind(this)); this.value = ""; });
  document.getElementById("raw-editor").addEventListener("input", function () { IDE.state.rawText = this.value; IDE.Json.highlight(document.getElementById("raw-highlight"), this.value); IDE.setDirty(true); try { IDE.Json.parse(this.value); document.getElementById("json-status").textContent = "Valid JSON"; } catch (_) { document.getElementById("json-status").textContent = "Invalid JSON"; } });
  document.getElementById("raw-editor").addEventListener("scroll", function () { var highlight = document.getElementById("raw-highlight"); highlight.scrollTop = this.scrollTop; highlight.scrollLeft = this.scrollLeft; });
  document.getElementById("format-button").addEventListener("click", function () { IDE.App.safe(async function () { if (IDE.state.activeView === "raw") { IDE.state.document = IDE.Json.parse(document.getElementById("raw-editor").value); } IDE.state.rawText = IDE.Json.pretty(IDE.state.document); syncRaw(); IDE.setDirty(true); }); });
  document.getElementById("refresh-prompt").addEventListener("click", IDE.Server.applyTemplate); document.getElementById("refresh-models").addEventListener("click", IDE.Server.loadModels); document.getElementById("refresh-slots").addEventListener("click", IDE.Server.loadSlots);
  document.querySelectorAll("[data-close-model-properties]").forEach(function (button) { button.addEventListener("click", function () { document.getElementById("model-properties-dialog").close(); }); });
  document.getElementById("run-button").addEventListener("click", function () {
    var runButton = document.getElementById("run-button"); var icon = runButton.querySelector(".action-icon"); var label = runButton.querySelector(".action-label");
    IDE.App.safe(async function () {
      runButton.disabled = true; runButton.classList.add("busy"); icon.textContent = "◌"; label.textContent = "Waiting for response"; runButton.setAttribute("aria-label", "Waiting for response");
      try {
        if (IDE.state.activeView === "raw") { IDE.state.document = IDE.Json.parse(document.getElementById("raw-editor").value); IDE.state.rawText = document.getElementById("raw-editor").value; }
        var count = 0, toolCount = 0;
        var turnLimit = IDE.state.settings.toolLoopLimit;
        for (var turn = 0; turn < turnLimit; turn += 1) {
          var requestDocument = JSON.parse(JSON.stringify(IDE.state.document));
          var streamedMessage = null;
          if (requestDocument.stream === true) {
            streamedMessage = { role: "assistant", content: "" }; IDE.state.document.messages.push(streamedMessage); IDE.setDirty(true); scheduleStreamRender();
          }
          var result = await IDE.Server.run(requestDocument, function (partial) {
            if (!streamedMessage) return;
            streamedMessage.content = partial.content;
            if (partial.reasoning) streamedMessage.reasoning_content = partial.reasoning;
            scheduleStreamRender();
          });
          count += captureResponse(result, streamedMessage);
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
      } finally {
        runButton.disabled = false; runButton.classList.remove("busy"); icon.textContent = "▶"; label.textContent = "Run request"; runButton.setAttribute("aria-label", "Run request");
      }
    });
  });
  document.addEventListener("keydown", function (event) { if (!(event.ctrlKey || event.metaKey)) return; if (event.key.toLowerCase() === "s") { event.preventDefault(); IDE.App.safe(IDE.Files.save); } if (event.key.toLowerCase() === "o") { event.preventDefault(); IDE.App.safe(IDE.Files.open); } if (event.key.toLowerCase() === "n") { event.preventDefault(); IDE.Files.newFile(); } });
  window.addEventListener("beforeunload", function (event) { if (IDE.state.dirty) { event.preventDefault(); event.returnValue = ""; } });
  IDE.state.rawText = IDE.Json.pretty(IDE.state.document); IDE.App.refreshAll();
})();
