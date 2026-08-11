(function () {
  "use strict";
  var IDE = window.LlamaIDE;
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, className, fn) {
    var node = el("button", className, label); node.type = "button"; node.addEventListener("click", fn); return node;
  }
  function commit() { IDE.state.rawText = IDE.Json.pretty(IDE.state.document); IDE.setDirty(true); }
  function contentEditor(message, key, body) {
    var group = el("div", "content-group");
    var title = el("div", "field-label"); title.append(el("span", "", key));
    title.append(button("+ Add part", "mini-button", function () {
      if (Array.isArray(message[key])) message[key].push({ type: "text", text: "" });
      else {
        var existing = message[key];
        message[key] = existing === "" || existing === null || existing === undefined
          ? [{ type: "text", text: "" }]
          : [{ type: "text", text: typeof existing === "string" ? existing : IDE.Json.scalarText(existing) }, { type: "text", text: "" }];
      }
      commit(); IDE.Rendered.render();
    }));
    group.append(title);
    var value = message[key];
    if (Array.isArray(value)) {
      value.forEach(function (part, partIndex) {
        var card = el("div", "part-card");
        var tools = el("div", "part-toolbar", "PART " + (partIndex + 1));
        tools.append(button("Remove", "danger-button", function () { value.splice(partIndex, 1); commit(); IDE.Rendered.render(); }));
        var area = el("textarea", "json-value"); area.value = IDE.Json.pretty(part); area.spellcheck = false;
        area.addEventListener("change", function () { try { value[partIndex] = JSON.parse(area.value); card.classList.remove("invalid"); commit(); } catch (_) { card.classList.add("invalid"); IDE.App.notice("This content part is not valid JSON. It remains visible and has not been applied."); } });
        card.append(tools, area); group.append(card);
      });
    } else {
      var area = el("textarea", "text-content"); area.value = IDE.Json.scalarText(value); area.spellcheck = true;
      area.addEventListener("input", function () { try { message[key] = IDE.Json.parseScalarText(area.value, value); commit(); } catch (_) { /* preserve draft until valid */ } });
      group.append(area);
    }
    body.append(group);
  }
  function messageCard(message, index, messages) {
    var card = el("article", "message-card");
    var head = el("div", "message-head"); head.append(el("span", "drag-index", "#" + (index + 1)));
    var role = el("input", "role-input"); role.value = message.role === undefined ? "" : String(message.role); role.setAttribute("list", "role-suggestions"); role.placeholder = "role";
    role.addEventListener("input", function () { message.role = role.value; commit(); });
    head.append(role, el("span", "spacer"), button("Remove message", "danger-button", function () { messages.splice(index, 1); commit(); IDE.Rendered.render(); }));
    var body = el("div", "message-body");
    Object.keys(message).forEach(function (key) {
      if (key === "role") return;
      if (key === "content" || key === "reasoning_content") contentEditor(message, key, body);
      else {
        var group = el("div", "content-group"); group.append(el("div", "field-label", key));
        var area = el("textarea", "json-value"); area.value = IDE.Json.scalarText(message[key]);
        area.addEventListener("change", function () { try { message[key] = IDE.Json.parseScalarText(area.value, message[key]); group.classList.remove("invalid"); commit(); } catch (_) { group.classList.add("invalid"); } });
        group.append(area); body.append(group);
      }
    });
    var addFields = el("div", "content-group");
    if (!("content" in message)) addFields.append(button("+ content", "mini-button", function () { message.content = ""; commit(); IDE.Rendered.render(); }));
    if (!("reasoning_content" in message)) addFields.append(button("+ reasoning_content", "mini-button", function () { message.reasoning_content = ""; commit(); IDE.Rendered.render(); }));
    if (addFields.childNodes.length) body.append(addFields);
    card.append(head, body); return card;
  }
  function topField(key, value) {
    var card = el("div", "field-card"); card.append(el("div", "field-label", key));
    var suggestions = {
      reasoning_control: ["true", "false"], stream: ["true", "false"], backend_sampling: ["true", "false"],
      return_progress: ["true", "false"], timings_per_token: ["true", "false"], reasoning_format: ["auto", "none", "deepseek"],
      thinking_budget_tokens: ["0", "256", "512", "1024", "2048", "-1"], max_tokens: ["256", "512", "1024", "2048", "4096", "-1"]
    };
    var isCompact = key === "model" || suggestions[key];
    var input = el(isCompact ? "input" : "textarea", isCompact ? "field-input" : "json-value");
    input.value = IDE.Json.scalarText(value);
    if (!isCompact) input.rows = Math.min(12, Math.max(2, input.value.split("\n").length + 1));
    if (key === "model") input.setAttribute("list", "model-suggestions");
    if (suggestions[key]) {
      var listId = "suggestions-" + key; var list = document.getElementById(listId);
      if (!list) { list = el("datalist"); list.id = listId; suggestions[key].forEach(function (item) { var option = el("option"); option.value = item; list.append(option); }); document.body.append(list); }
      input.setAttribute("list", listId);
    }
    input.addEventListener("change", function () { try { IDE.state.document[key] = IDE.Json.parseScalarText(input.value, value); card.classList.remove("invalid"); commit(); if (key === "model") { IDE.Server.loadModel(); IDE.Server.loadSlots(); } } catch (error) { card.classList.add("invalid"); IDE.App.notice(key + ": " + error.message); } });
    card.append(input); return card;
  }
  IDE.Rendered = {
    render: function () {
      var root = document.getElementById("rendered-editor"); root.replaceChildren();
      var data = IDE.state.document; var messages = Array.isArray(data.messages) ? data.messages : null;
      var title = el("div", "section-title"); title.append(el("h2", "", "Messages"), el("span", "count", messages ? messages.length + " ITEMS" : "NOT AN ARRAY")); root.append(title);
      if (messages) {
        messages.forEach(function (message, index) { root.append(messageCard(message, index, messages)); });
        root.append(button("+ Add message", "secondary", function () { messages.push({ role: "user", content: "" }); commit(); IDE.Rendered.render(); }));
      } else root.append(topField("messages", data.messages));
      var otherKeys = Object.keys(data).filter(function (key) { return key !== "messages"; });
      var otherTitle = el("div", "section-title"); otherTitle.style.marginTop = "28px"; otherTitle.append(el("h2", "", "Request fields"), el("span", "count", otherKeys.length + " FIELDS")); root.append(otherTitle);
      otherKeys.forEach(function (key) { root.append(topField(key, data[key])); });
      if (!document.getElementById("role-suggestions")) {
        var list = el("datalist"); list.id = "role-suggestions"; ["system", "tool", "user", "assistant"].forEach(function (v) { var o = el("option"); o.value = v; list.append(o); }); document.body.append(list);
      }
    }
  };
})();
