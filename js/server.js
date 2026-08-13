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
    run: async function () {
      if (IDE.state.document.stream === true) throw new Error("This request has stream: true. SSE support is intentionally not implemented yet. Change the field yourself to run it; the IDE will not override your request.");
      return request("/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(IDE.state.document) });
    }
  };
})();
