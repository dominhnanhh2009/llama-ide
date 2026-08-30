(function () {
  "use strict";
  var IDE = window.LlamaIDE;
  function url(path) { return IDE.state.settings.baseUrl.replace(/\/$/, "") + path; }
  async function request(path, options) {
    if (!IDE.state.settings.baseUrl) throw new Error("Set llama-server base URL in Settings first.");
    var response = await fetch(url(path), options);
    var text = await response.text();
    if (!response.ok) throw new Error(response.status + " " + response.statusText + (text ? "\n" + text : ""));
    try { return JSON.parse(text); } catch (_) { return text; }
  }
  function mergeToolCall(message, part) {
    if (!Array.isArray(message.tool_calls)) message.tool_calls = [];
    var index = Number.isInteger(part.index) ? part.index : message.tool_calls.length;
    var target = message.tool_calls[index] || {};
    if (part.id !== undefined) target.id = part.id;
    if (part.type !== undefined) target.type = part.type;
    if (part.function) {
      target.function = target.function || {};
      if (part.function.name) target.function.name = (target.function.name || "") + part.function.name;
      if (part.function.arguments) target.function.arguments = (target.function.arguments || "") + part.function.arguments;
    }
    message.tool_calls[index] = target;
  }
  function mergeChunk(result, chunk) {
    Object.keys(chunk).forEach(function (key) {
      if (key === "choices" || key === "error") return;
      result[key] = key === "object" && typeof chunk[key] === "string" ? chunk[key].replace(".chunk", "") : chunk[key];
    });
    result.object = result.object || "chat.completion";
    (chunk.choices || []).forEach(function (part) {
      var index = Number.isInteger(part.index) ? part.index : 0;
      var choice = result.choices[index] || { index: index, message: { role: "assistant" }, finish_reason: null };
      var delta = part.delta || {};
      Object.keys(delta).forEach(function (key) {
        if (key === "tool_calls" && Array.isArray(delta.tool_calls)) delta.tool_calls.forEach(function (call) { mergeToolCall(choice.message, call); });
        else if (key === "content" || key === "reasoning_content" || key === "reasoning") choice.message[key] = (choice.message[key] || "") + (delta[key] || "");
        else if (delta[key] !== undefined) choice.message[key] = delta[key];
      });
      if (part.finish_reason !== undefined && part.finish_reason !== null) choice.finish_reason = part.finish_reason;
      if (part.logprobs !== undefined) choice.logprobs = part.logprobs;
      result.choices[index] = choice;
    });
  }
  function partialText(result) {
    var message = result.choices[0] && result.choices[0].message || {};
    var toolCalls = null;
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
      toolCalls = JSON.parse(JSON.stringify(message.tool_calls));
    }
    return {
      content: message.content || "",
      reasoning: message.reasoning_content || message.reasoning || "",
      tool_calls: toolCalls
    };
  }
  async function streamRequest(path, options, onProgress) {
    if (!IDE.state.settings.baseUrl) throw new Error("Set llama-server base URL in Settings first.");
    var controller = new AbortController(); options.signal = controller.signal;
    var stream = { controller: controller, stopped: false };
    IDE.Server.activeStream = stream;
    var response;
    try { response = await fetch(url(path), options); }
    catch (error) {
      if (IDE.Server.activeStream === stream) IDE.Server.activeStream = null;
      if (stream.stopped && error.name === "AbortError") return { object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "cancelled" }], stopped: true };
      throw error;
    }
    if (!response.ok) { var errorText = await response.text(); if (IDE.Server.activeStream === stream) IDE.Server.activeStream = null; throw new Error(response.status + " " + response.statusText + (errorText ? "\n" + errorText : "")); }
    if (!response.body) { if (IDE.Server.activeStream === stream) IDE.Server.activeStream = null; throw new Error("This browser did not expose the SSE response stream."); }
    var reader = response.body.getReader(), decoder = new TextDecoder(), buffer = "";
    var result = { object: "chat.completion", choices: [] }, doneEvent = false;
    function consume(block) {
      var data = block.split(/\r?\n/).filter(function (line) { return line.indexOf("data:") === 0; }).map(function (line) { return line.slice(5).trimStart(); }).join("\n");
      if (!data) return;
      if (data.trim() === "[DONE]") { doneEvent = true; return; }
      var chunk;
      try { chunk = JSON.parse(data); } catch (error) { throw new Error("Invalid SSE data: " + error.message); }
      if (chunk.error) throw new Error(chunk.error.message || JSON.stringify(chunk.error));
      mergeChunk(result, chunk); if (onProgress) onProgress(partialText(result));
    }
    try {
      while (!doneEvent) {
        var next = await reader.read(); buffer += decoder.decode(next.value || new Uint8Array(), { stream: !next.done });
        var boundary;
        while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) { var block = buffer.slice(0, boundary); buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, ""); consume(block); }
        if (next.done) { if (buffer.trim()) consume(buffer); break; }
      }
    } catch (error) {
      if (!stream.stopped || error.name !== "AbortError") throw error;
    } finally {
      if (IDE.Server.activeStream === stream) IDE.Server.activeStream = null;
    }
    result.choices = result.choices.filter(Boolean);
    if (stream.stopped) {
      if (!result.choices.length) result.choices.push({ index: 0, message: { role: "assistant", content: "" }, finish_reason: "cancelled" });
      result.choices.forEach(function (choice) { choice.finish_reason = "cancelled"; });
      result.stopped = true;
    }
    return result;
  }
  function flatten(value, prefix, rows) {
    if (value && typeof value === "object") Object.keys(value).forEach(function (key) { flatten(value[key], prefix ? prefix + "." + key : key, rows); });
    else rows.push([prefix, String(value)]);
  }
  function currentModel() {
    return typeof IDE.state.document.model === "string" && IDE.state.document.model.trim() ? IDE.state.document.model.trim() : "";
  }
  function withModel(path) {
    var model = currentModel();
    return model ? path + (path.indexOf("?") === -1 ? "?" : "&") + "model=" + encodeURIComponent(model) : path;
  }
  function updateModelSuggestions(models) {
    var list = document.getElementById("model-suggestions");
    if (!list) {
      list = document.createElement("datalist"); list.id = "model-suggestions"; document.body.append(list);
    }
    list.replaceChildren();
    models.forEach(function (model) {
      if (!model || typeof model.id !== "string") return;
      var option = document.createElement("option"); option.value = model.id;
      option.label = model.status && model.status.value ? model.status.value : "server model";
      list.append(option);
    });
  }
  function statusValue(model) {
    var status = model && model.status;
    return String(status && typeof status === "object" ? status.value || status.status || "unknown" : status || "unknown").toLowerCase();
  }
  function usableModels(models) { return models.filter(function (model) { return model.id !== "default"; }); }
  function isLoaded(model) { var status = statusValue(model); return status === "loaded" || status === "sleeping"; }
  async function loadCatalog(selectFirst) {
    var catalog = await request("/v1/models");
    var models = usableModels(catalog && Array.isArray(catalog.data) ? catalog.data.filter(function (model) { return model && typeof model.id === "string"; }) : []);
    updateModelSuggestions(models);
    if (selectFirst) {
      var loaded = models.filter(isLoaded);
      var nextModel = loaded.length ? loaded[Math.floor(Math.random() * loaded.length)].id : "";
      if (IDE.state.document.model !== nextModel) { IDE.state.document.model = nextModel; IDE.state.rawText = IDE.Json.pretty(IDE.state.document); IDE.setDirty(true); }
    }
    return models;
  }
  async function modelProperties(model) {
    return request("/props?model=" + encodeURIComponent(model));
  }
  IDE.Server = {
    activeStream: null,
    stop: function () {
      var stream = IDE.Server.activeStream;
      if (!stream || stream.stopped) return false;
      stream.stopped = true; stream.controller.abort(); return true;
    },
    showModelProperties: async function (model) {
      var dialog = document.getElementById("model-properties-dialog");
      document.getElementById("model-properties-title").textContent = model;
      var host = document.getElementById("model-properties"); host.innerHTML = '<p class="empty-state">Loading…</p>';
      dialog.showModal();
      try {
        var data = await modelProperties(model); var rows = []; flatten(data, "", rows); host.replaceChildren();
        rows.forEach(function (pair) { var row = document.createElement("div"); row.className = "kv-row"; var k = document.createElement("span"); k.textContent = pair[0]; var v = document.createElement("span"); v.textContent = pair[1]; row.append(k, v); host.append(row); });
      } catch (error) { host.innerHTML = '<p class="empty-state"></p>'; host.firstChild.textContent = error.message; }
    },
    loadModels: async function () {
      var host = document.getElementById("models-status"); host.innerHTML = '<p class="empty-state">Loading…</p>';
      try {
        var models = await loadCatalog(false); host.replaceChildren();
        if (!models.length) { host.innerHTML = '<p class="empty-state">No models available.</p>'; return; }
        models.forEach(function (model) {
          var status = statusValue(model), loaded = isLoaded(model);
          var row = document.createElement("div"); row.className = "model-row";
          var summary = document.createElement("div"); summary.className = "model-name"; summary.textContent = model.id;
          var state = document.createElement("span"); state.className = "model-state " + status; state.textContent = status; summary.append(state);
          var info = document.createElement("button"); info.className = "icon-button model-info-button"; info.type = "button"; info.textContent = "i"; info.title = "Show model properties";
          info.addEventListener("click", function () { IDE.App.safe(function () { return IDE.Server.showModelProperties(model.id); }); });
          var action = document.createElement("button"); action.className = loaded ? "danger-button model-action" : "secondary model-action"; action.type = "button"; action.textContent = loaded ? "Unload" : "Load";
          action.disabled = status === "loading" || status === "unloading";
          action.addEventListener("click", function () { IDE.App.safe(function () { return IDE.Server.setModelLoaded(model.id, !loaded); }); });
          row.append(summary, info, action); host.append(row);
        });
      } catch (error) { host.innerHTML = '<p class="empty-state"></p>'; host.firstChild.textContent = error.message; }
    },
    setModelLoaded: async function (model, load) {
      await request(load ? "/models/load" : "/models/unload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: model }) });
      await IDE.Server.loadModels();
      if (load && !currentModel()) { IDE.state.document.model = model; IDE.state.rawText = IDE.Json.pretty(IDE.state.document); IDE.setDirty(true); IDE.App.refreshAll(); }
      if (!load && currentModel() === model) {
        var models = await loadCatalog(false), loaded = models.filter(isLoaded);
        IDE.state.document.model = loaded.length ? loaded[Math.floor(Math.random() * loaded.length)].id : ""; IDE.state.rawText = IDE.Json.pretty(IDE.state.document); IDE.setDirty(true); IDE.App.refreshAll();
      }
      await IDE.Server.loadSlots();
    },
    loadSlots: async function () {
      var host = document.getElementById("slots-status"); host.innerHTML = '<p class="empty-state">Loading…</p>';
      try {
        if (!currentModel()) throw new Error("The request document has no model field. The router requires a model name for /slots; the IDE will not choose one automatically.");
        var data = await request(withModel("/slots")); host.replaceChildren();
        (Array.isArray(data) ? data : [data]).forEach(function (slot, i) {
          var used = Number(slot.n_past || slot.n_tokens || 0), total = Number(slot.n_ctx || 0), pct = total ? Math.min(100, used / total * 100) : 0;
          var box = document.createElement("div"); box.className = "slot"; box.innerHTML = '<div class="slot-line"><strong>SLOT ' + (slot.id !== undefined ? slot.id : i) + '</strong><span class="slot-state"></span></div><div class="slot-line"><span>context</span><span>' + used + ' / ' + (total || "?") + '</span></div><div class="meter"><span style="width:' + pct + '%"></span></div>';
          box.querySelector(".slot-state").textContent = slot.state || (slot.is_processing ? "processing" : "idle"); host.append(box);
        });
      } catch (error) { host.innerHTML = '<p class="empty-state"></p>'; host.firstChild.textContent = error.message; }
    },
    connect: async function () {
      var button = document.getElementById("connect-server-button"); button.disabled = true; button.classList.add("busy");
      IDE.App.connection(false, "Connecting…");
      try {
        var health = await request("/health");
        var models = await loadCatalog(true);
        IDE.App.refreshAll();
        await Promise.all([IDE.Server.loadModels(), IDE.Server.loadSlots()]);
        var healthLabel = health && typeof health === "object" ? (health.status || health.message || "healthy") : (health || "healthy");
        IDE.App.connection(true, "Connected · " + models.length + " model" + (models.length === 1 ? "" : "s") + " · " + healthLabel);
        IDE.App.notice(currentModel() ? "Connected to llama-server. Selected loaded model " + currentModel() + "." : "Connected to llama-server, but no loaded models were returned.");
      } finally { button.disabled = false; button.classList.remove("busy"); }
    },
    applyTemplate: async function () {
      var out = document.getElementById("prompt-editor"); out.value = "Loading /apply-template…";
      try {
        var data = await request("/apply-template", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(IDE.state.document) });
        out.value = data && typeof data === "object" && typeof data.prompt === "string" ? data.prompt : typeof data === "string" ? data : JSON.stringify(data, null, 2);
      }
      catch (error) { out.value = "ERROR\n" + error.message; }
    },
    run: async function (document, onProgress) {
      var payload = document || IDE.state.document; var streaming = payload.stream === true;
      var options = { method: "POST", headers: { "Content-Type": "application/json", "Accept": streaming ? "text/event-stream" : "application/json" }, body: JSON.stringify(payload) };
      return streaming ? streamRequest("/v1/chat/completions", options, onProgress) : request("/v1/chat/completions", options);
    }
  };
})();
