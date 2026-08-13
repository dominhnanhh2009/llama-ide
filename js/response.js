(function () {
  "use strict";
  var IDE = window.LlamaIDE;
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function valueText(value) {
    if (value === undefined || value === null || value === "") return "—";
    if (typeof value === "number" && !Number.isInteger(value)) return String(Math.round(value * 1000) / 1000);
    return String(value);
  }
  function flatten(value, prefix, rows) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.keys(value).forEach(function (key) { flatten(value[key], prefix ? prefix + "." + key : key, rows); });
    } else if (Array.isArray(value)) value.forEach(function (item, index) { flatten(item, prefix + "." + index, rows); });
    else rows.push([prefix, valueText(value)]);
  }
  function stat(label, value) {
    var card = el("div", "response-stat"); card.append(el("span", "response-stat-label", label), el("span", "response-stat-value", valueText(value))); return card;
  }
  function section(title, value) {
    var rows = []; flatten(value, "", rows);
    if (!rows.length) return null;
    var box = el("section", "response-section"); box.append(el("div", "response-section-head", title));
    rows.forEach(function (pair) { var row = el("div", "response-choice"); row.append(el("span", "", pair[0] || "value"), el("span", "", pair[1])); box.append(row); });
    return box;
  }
  function createdText(value) {
    if (typeof value !== "number") return value;
    try { return new Date(value * 1000).toLocaleString(); } catch (_) { return value; }
  }
  function choiceMetadata(choices) {
    return choices.map(function (choice) {
      var metadata = {};
      Object.keys(choice || {}).forEach(function (key) { if (key !== "message" && key !== "delta" && key !== "text") metadata[key] = choice[key]; });
      return metadata;
    });
  }
  IDE.Response = {
    render: function () {
      var panel = document.getElementById("response-panel"); var root = document.getElementById("response-editor"); var toggle = document.getElementById("response-toggle"); var status = document.getElementById("response-status");
      if (!panel || !root) return;
      panel.classList.toggle("collapsed", !IDE.state.responseOpen); toggle.setAttribute("aria-expanded", String(IDE.state.responseOpen)); root.replaceChildren();
      var response = IDE.state.lastResponse;
      if (!response || typeof response !== "object") { status.textContent = "No response"; root.append(el("p", "empty-state", "Run a request to inspect response metadata. It stays in this browser session and is not added to the request JSON.")); return; }
      var usage = response.usage || {}; var timings = response.timings || {}; var choices = Array.isArray(response.choices) ? response.choices : [];
      status.textContent = valueText(response.model) + " · " + valueText(usage.total_tokens) + " tokens";
      var content = el("div", "response-content"); var summary = el("div", "response-summary");
      summary.append(stat("Model", response.model), stat("Created", createdText(response.created)), stat("Object", response.object), stat("Choices", choices.length), stat("Prompt tokens", usage.prompt_tokens), stat("Completion tokens", usage.completion_tokens), stat("Total tokens", usage.total_tokens), stat("Generation tok/s", timings.predicted_per_second));
      content.append(summary);
      var identity = section("Identity", { id: response.id, system_fingerprint: response.system_fingerprint }); if (identity) content.append(identity);
      var choiceBox = section("Choice metadata", choiceMetadata(choices)); if (choiceBox) content.append(choiceBox);
      var usageBox = section("Usage", usage); if (usageBox) content.append(usageBox);
      var timingBox = section("Timings", timings); if (timingBox) content.append(timingBox);
      var known = { id: true, model: true, created: true, object: true, system_fingerprint: true, choices: true, usage: true, timings: true };
      var extra = {}; Object.keys(response).forEach(function (key) { if (!known[key]) extra[key] = response[key]; });
      var extraBox = section("Additional metadata", extra); if (extraBox) content.append(extraBox);
      root.append(content);
    }
  };
})();
