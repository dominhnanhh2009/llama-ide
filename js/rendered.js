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
  function autoSize(area) {
    area.style.height = "0";
    area.style.height = Math.max(area.scrollHeight + 2, 78) + "px";
  }
  function expandingArea(className, value) {
    var area = el("textarea", className);
    area.value = value;
    area.addEventListener("input", function () { autoSize(area); });
    requestAnimationFrame(function () { autoSize(area); });
    return area;
  }
  function commit() { IDE.state.rawText = IDE.Json.pretty(IDE.state.document); IDE.setDirty(true); }
  function imageUrl(part) {
    var source = part && part.image_url;
    return typeof source === "string" ? source : source && typeof source.url === "string" ? source.url : "";
  }
  function setImageUrl(part, url) {
    if (typeof part.image_url === "string") part.image_url = url;
    else {
      if (!part.image_url || typeof part.image_url !== "object" || Array.isArray(part.image_url)) part.image_url = {};
      part.image_url.url = url;
    }
  }
  function partIsEmpty(part) {
    if (!part || typeof part !== "object") return true;
    if (part.type === "text") return !part.text;
    if (part.type === "image_url") return !imageUrl(part);
    return Object.keys(part).every(function (key) { return key === "type" || part[key] === "" || part[key] === null || part[key] === undefined; });
  }
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error("Could not read " + file.name + ".")); };
      reader.readAsDataURL(file);
    });
  }
  async function fillPartFromFile(part, file) {
    var isImage = file.type && file.type.indexOf("image/") === 0;
    if (part.type === "image_url" && !isImage) throw new Error("An image_url part only accepts image files or an image link.");
    var content = isImage ? await readImage(file) : "\n\n--- File: " + file.name + " ---\n" + await file.text();
    Object.keys(part).forEach(function (key) { delete part[key]; });
    if (isImage) {
      part.type = "image_url"; part.image_url = { url: content };
    } else {
      part.type = "text"; part.text = content;
    }
    commit(); IDE.Rendered.render(); IDE.App.notice("Added " + file.name + " to this part.");
  }
  function enablePartDrop(node, part) {
    var depth = 0;
    node.classList.add("file-drop-target", partIsEmpty(part) ? "drop-available" : "drop-locked");
    node.addEventListener("dragenter", function (event) { if (!event.dataTransfer || !event.dataTransfer.types || Array.prototype.indexOf.call(event.dataTransfer.types, "Files") === -1) return; event.preventDefault(); depth += 1; node.classList.add("drag-over"); });
    node.addEventListener("dragover", function (event) { if (!event.dataTransfer || !event.dataTransfer.types || Array.prototype.indexOf.call(event.dataTransfer.types, "Files") === -1) return; event.preventDefault(); event.dataTransfer.dropEffect = partIsEmpty(part) ? "copy" : "none"; });
    node.addEventListener("dragleave", function () { depth -= 1; if (depth <= 0) { depth = 0; node.classList.remove("drag-over"); } });
    node.addEventListener("drop", function (event) {
      event.preventDefault(); depth = 0; node.classList.remove("drag-over");
      if (!event.dataTransfer.files || !event.dataTransfer.files.length) return;
      if (!partIsEmpty(part)) { IDE.App.notice("Clear this part before dropping a file into it."); return; }
      if (event.dataTransfer.files.length !== 1) { IDE.App.notice("Each part accepts one file. Add another empty part for each additional file."); return; }
      IDE.App.safe(function () { return fillPartFromFile(part, event.dataTransfer.files[0]); });
    });
  }
  function imagePart(part) {
    var frame = el("div", "image-part");
    var url = imageUrl(part);
    if (typeof url !== "string" || !url) {
      frame.append(el("div", "image-fallback", "Drop an image here or enter an image link above."));
      return frame;
    }
    function showLink(label) {
      frame.replaceChildren();
      var link = el("a", "image-link", label || url); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
      frame.append(link);
    }
    function showImage(src, revoke) {
      var image = el("img", "part-image"); image.alt = "Message image"; image.loading = "lazy";
      image.addEventListener("load", function () { if (revoke) URL.revokeObjectURL(src); });
      image.addEventListener("error", function () { if (revoke) URL.revokeObjectURL(src); showLink("Open image link"); });
      image.src = src; frame.append(image);
    }
    if (/^data:image\//i.test(url) || /^blob:/i.test(url)) showImage(url, false);
    else if (/^https?:\/\//i.test(url)) {
      frame.append(el("div", "image-loading", "Loading image preview…"));
      fetch(url, { mode: "cors" }).then(function (response) {
        if (!response.ok) throw new Error("Image request failed");
        var type = response.headers.get("content-type") || "";
        if (type.indexOf("image/") !== 0) throw new Error("URL is not an image");
        return response.blob();
      }).then(function (blob) { frame.replaceChildren(); var objectUrl = URL.createObjectURL(blob); showImage(objectUrl, true); })
        .catch(function () { showLink(url); });
    } else showLink(url);
    return frame;
  }
  function changePartType(part, type) {
    var previous = part.type;
    if (type === previous) return;
    if (type === "image_url") { var text = typeof part.text === "string" ? part.text.trim() : ""; delete part.text; part.image_url = { url: text }; }
    else if (type === "text") { var url = imageUrl(part); delete part.image_url; part.text = url; }
    part.type = type; commit(); IDE.Rendered.render();
  }
  function renderPart(part, card) {
    if (part.type === "image_url") {
      card.classList.add("image-card");
      var currentUrl = imageUrl(part); var embedded = /^data:image\//i.test(currentUrl);
      var urlInput = el("input", "image-url-input"); urlInput.type = "url"; urlInput.placeholder = embedded ? "Embedded image — enter a link to replace it" : "https://example.com/image.png"; urlInput.value = embedded ? "" : currentUrl;
      urlInput.addEventListener("change", function () { setImageUrl(part, urlInput.value.trim()); commit(); IDE.Rendered.render(); });
      card.append(urlInput, imagePart(part)); return;
    }
    if (part.type === "text") {
      var textArea = expandingArea("text-content", typeof part.text === "string" ? part.text : ""); textArea.spellcheck = true;
      textArea.addEventListener("input", function () { part.text = textArea.value; card.classList.remove("invalid"); commit(); });
      card.append(textArea); return;
    }
    var payload = {}; Object.keys(part).forEach(function (key) { if (key !== "type") payload[key] = part[key]; });
    var area = expandingArea("json-value", IDE.Json.pretty(payload)); area.spellcheck = false;
    area.addEventListener("change", function () {
      try {
        var next = JSON.parse(area.value); if (!next || Array.isArray(next) || typeof next !== "object") throw new Error("Part fields must be a JSON object.");
        Object.keys(part).forEach(function (key) { if (key !== "type") delete part[key]; }); Object.assign(part, next); card.classList.remove("invalid"); commit();
      } catch (error) { card.classList.add("invalid"); IDE.App.notice(error.message); }
    });
    card.append(area);
  }
  function valueType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value === "object" ? "object" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
  }
  function defaultValue(type) {
    return type === "object" ? {} : type === "array" ? [] : type === "number" ? 0 : type === "boolean" ? false : type === "null" ? null : "";
  }
  function structuredEditor(initialValue, onChange) {
    var root = el("div", "structured-editor"); var value = initialValue;
    function changed(next) { value = next; onChange(next); draw(); }
    function node(current, update) {
      var box = el("div"); var head = el("div", "structured-head"); var type = el("select", "structured-type");
      ["string", "number", "boolean", "null", "object", "array"].forEach(function (name) { var option = el("option", "", name); option.value = name; type.append(option); });
      type.value = valueType(current); type.addEventListener("change", function () { update(defaultValue(type.value)); }); head.append(type); box.append(head);
      var kind = valueType(current);
      if (kind === "object") {
        Object.keys(current).forEach(function (key) {
          var entry = el("div", "structured-entry"); var entryHead = el("div", "structured-entry-head"); var keyInput = el("input", "structured-key"); keyInput.value = key;
          keyInput.addEventListener("change", function () { var nextKey = keyInput.value.trim(); if (!nextKey || nextKey === key) return; var next = Object.assign({}, current); next[nextKey] = next[key]; delete next[key]; update(next); });
          entryHead.append(keyInput, button("Remove", "danger-button", function () { var next = Object.assign({}, current); delete next[key]; update(next); }));
          entry.append(entryHead, node(current[key], function (nextValue) { var next = Object.assign({}, current); next[key] = nextValue; update(next); })); box.append(entry);
        });
        box.append(button("+ Property", "mini-button", function () { var next = Object.assign({}, current), index = 1, key = "field"; while (key in next) { index += 1; key = "field" + index; } next[key] = ""; update(next); }));
      } else if (kind === "array") {
        current.forEach(function (item, index) {
          var entry = el("div", "structured-entry"); var entryHead = el("div", "structured-entry-head"); entryHead.append(el("span", "drag-index", "#" + (index + 1)), button("Remove", "danger-button", function () { var next = current.slice(); next.splice(index, 1); update(next); }));
          entry.append(entryHead, node(item, function (nextValue) { var next = current.slice(); next[index] = nextValue; update(next); })); box.append(entry);
        });
        box.append(button("+ Item", "mini-button", function () { update(current.concat([""])); }));
      } else if (kind === "boolean") {
        var boolLabel = el("label", "structured-boolean"); var checkbox = el("input"); checkbox.type = "checkbox"; checkbox.checked = current; checkbox.addEventListener("change", function () { update(checkbox.checked); }); boolLabel.append(checkbox, el("span", "", current ? "true" : "false")); box.append(boolLabel);
      } else if (kind === "null") box.append(el("span", "empty-state", "null"));
      else {
        var input = el("input", "structured-scalar"); input.type = kind === "number" ? "number" : "text"; input.value = current;
        input.addEventListener("change", function () { update(kind === "number" ? Number(input.value) : input.value); }); box.append(input);
      }
      return box;
    }
    function draw() { root.replaceChildren(node(value, changed)); }
    draw(); return root;
  }
  function replaceExtraFields(target, reserved, next) {
    Object.keys(target).forEach(function (key) { if (reserved.indexOf(key) === -1) delete target[key]; });
    Object.keys(next).forEach(function (key) { target[key] = next[key]; });
  }
  function toolCallsEditor(message, key, body) {
    var group = el("div", "content-group"); var calls = message[key]; var title = el("div", "field-label"); title.append(el("span", "", key), button("+ Tool call", "mini-button", function () { calls.push({ id: "", type: "function", function: { name: "", arguments: "{}" } }); commit(); IDE.Rendered.render(); })); group.append(title);
    calls.forEach(function (call, index) {
      if (!call || typeof call !== "object" || Array.isArray(call)) call = calls[index] = { id: "", type: "function", function: { name: "", arguments: "{}" } };
      if (!call.function || typeof call.function !== "object" || Array.isArray(call.function)) call.function = {};
      var card = el("div", "tool-call-card"); var head = el("div", "tool-call-head");
      var id = el("input"); id.placeholder = "call id"; id.value = call.id || ""; id.addEventListener("input", function () { call.id = id.value; commit(); });
      var type = el("input"); type.placeholder = "type"; type.value = call.type || ""; type.addEventListener("input", function () { call.type = type.value; commit(); });
      var name = el("input"); name.placeholder = "function name"; name.value = call.function.name || ""; name.addEventListener("input", function () { call.function.name = name.value; commit(); });
      head.append(id, type, name, button("Remove", "danger-button", function () { calls.splice(index, 1); commit(); IDE.Rendered.render(); }));
      var callBody = el("div", "tool-call-body"); var originalString = typeof call.function.arguments === "string"; var args;
      try { args = originalString ? JSON.parse(call.function.arguments || "{}") : call.function.arguments; }
      catch (_) { args = { unparsed_arguments: call.function.arguments }; }
      callBody.append(toolField("Arguments", structuredEditor(args, function (next) { call.function.arguments = originalString ? JSON.stringify(next) : next; commit(); }), "full-width"));
      var callExtras = {}; Object.keys(call).forEach(function (field) { if (["id", "type", "function"].indexOf(field) === -1) callExtras[field] = call[field]; });
      var fnExtras = {}; Object.keys(call.function).forEach(function (field) { if (["name", "arguments"].indexOf(field) === -1) fnExtras[field] = call.function[field]; });
      callBody.append(toolField("Additional call fields", structuredEditor(callExtras, function (next) { replaceExtraFields(call, ["id", "type", "function"], next); commit(); }), "full-width"));
      callBody.append(toolField("Additional function fields", structuredEditor(fnExtras, function (next) { replaceExtraFields(call.function, ["name", "arguments"], next); commit(); }), "full-width"));
      card.append(head, callBody); group.append(card);
    });
    body.append(group);
  }
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
        if (!part || typeof part !== "object" || Array.isArray(part)) { part = { type: "text", text: IDE.Json.scalarText(part) }; value[partIndex] = part; }
        var tools = el("div", "part-toolbar"); tools.append(el("span", "", "PART " + (partIndex + 1)));
        var typeWrap = el("label", "part-type-label", "TYPE"); var typeInput = el("input", "part-type-input"); typeInput.value = typeof part.type === "string" ? part.type : ""; typeInput.setAttribute("list", "part-type-suggestions");
        typeInput.addEventListener("change", function () { changePartType(part, typeInput.value.trim()); }); typeWrap.append(typeInput); tools.append(typeWrap);
        tools.append(button("Remove", "danger-button", function () { value.splice(partIndex, 1); commit(); IDE.Rendered.render(); }));
        card.append(tools); renderPart(part, card); enablePartDrop(card, part); group.append(card);
      });
    } else {
      var area = expandingArea("text-content", IDE.Json.scalarText(value)); area.spellcheck = true;
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
      else if (key === "tool_calls" && Array.isArray(message[key])) toolCallsEditor(message, key, body);
      else {
        var group = el("div", "content-group"); group.append(el("div", "field-label", key));
        var area = expandingArea("json-value", IDE.Json.scalarText(message[key]));
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
  function toolField(label, control, className) {
    var field = el("div", "tool-field" + (className ? " " + className : "")); field.append(el("label", "", label), control); return field;
  }
  function toolCard(tool, index, collection, enabled) {
    var card = el("article", "tool-card" + (enabled ? "" : " disabled"));
    var head = el("div", "tool-head"); var enabledLabel = el("label", "tool-enabled"); var toggle = el("input"); toggle.type = "checkbox"; toggle.checked = enabled;
    enabledLabel.append(toggle, el("span", "", "Enabled"));
    toggle.addEventListener("change", function () {
      collection.splice(index, 1);
      if (toggle.checked) {
        if (!Array.isArray(IDE.state.document.tools)) IDE.state.document.tools = [];
        IDE.state.document.tools.push(tool);
      } else IDE.state.disabledTools.push(tool);
      commit(); IDE.Rendered.render();
    });
    head.append(enabledLabel, el("span", "drag-index", "#" + (index + 1)), el("span", "spacer"), button("Remove tool", "danger-button", function () { collection.splice(index, 1); commit(); IDE.Rendered.render(); }));
    var body = el("div", "tool-body");
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      body.append(toolField("Tool value", structuredEditor(tool, function (next) { collection[index] = next; commit(); }), "full-width")); card.append(head, body); return card;
    }
    var fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : {};
    function ensureFunction() { if (!tool.function || typeof tool.function !== "object" || Array.isArray(tool.function)) tool.function = {}; return tool.function; }
    var type = el("input"); type.value = tool.type === undefined ? "" : String(tool.type); type.addEventListener("input", function () { tool.type = type.value; commit(); });
    var name = el("input"); name.value = fn.name === undefined ? "" : String(fn.name); name.addEventListener("input", function () { ensureFunction().name = name.value; commit(); });
    var description = expandingArea("", fn.description === undefined ? "" : String(fn.description)); description.addEventListener("input", function () { ensureFunction().description = description.value; commit(); });
    var parameters = structuredEditor(fn.parameters === undefined ? { type: "object", properties: {} } : fn.parameters, function (next) { ensureFunction().parameters = next; commit(); });
    var toolExtras = {}; Object.keys(tool).forEach(function (field) { if (["type", "function"].indexOf(field) === -1) toolExtras[field] = tool[field]; });
    var fnExtras = {}; Object.keys(fn).forEach(function (field) { if (["name", "description", "parameters"].indexOf(field) === -1) fnExtras[field] = fn[field]; });
    body.append(toolField("Type", type), toolField("Function name", name), toolField("Description", description, "full-width"), toolField("Parameters", parameters, "full-width"));
    body.append(toolField("Additional tool fields", structuredEditor(toolExtras, function (next) { replaceExtraFields(tool, ["type", "function"], next); commit(); }), "full-width"));
    body.append(toolField("Additional function fields", structuredEditor(fnExtras, function (next) { replaceExtraFields(ensureFunction(), ["name", "description", "parameters"], next); commit(); }), "full-width"));
    card.append(head, body); return card;
  }
  function renderTools(root, data) {
    var tools = Array.isArray(data.tools) ? data.tools : null; var disabled = IDE.state.disabledTools;
    var total = (tools ? tools.length : 0) + disabled.length;
    var title = el("div", "section-title"); title.append(el("h2", "", "Tools"), el("span", "count", (tools ? tools.length : 0) + " ENABLED · " + total + " TOTAL")); root.append(title);
    if (!tools && data.tools !== undefined) {
      var invalidCard = el("div", "field-card invalid"); invalidCard.append(el("div", "field-label", "tools must be an array"), structuredEditor(data.tools, function (next) { data.tools = next; commit(); IDE.Rendered.render(); })); root.append(invalidCard);
    }
    else {
      (tools || []).forEach(function (tool, index) { root.append(toolCard(tool, index, tools, true)); });
      disabled.forEach(function (tool, index) { root.append(toolCard(tool, index, disabled, false)); });
      root.append(button("+ Add tool", "secondary", function () { if (!Array.isArray(data.tools)) data.tools = []; data.tools.push({ type: "function", function: { name: "", description: "", parameters: { type: "object", properties: {} } } }); commit(); IDE.Rendered.render(); }));
    }
  }
  function topField(key, value) {
    var card = el("div", "field-card"); card.append(el("div", "field-label", key));
    var suggestions = {
      reasoning_control: ["true", "false"], stream: ["true", "false"], backend_sampling: ["true", "false"],
      return_progress: ["true", "false"], timings_per_token: ["true", "false"], reasoning_format: ["auto", "none", "deepseek"],
      thinking_budget_tokens: ["0", "256", "512", "1024", "2048", "-1"], max_tokens: ["256", "512", "1024", "2048", "4096", "-1"]
    };
    var isCompact = key === "model" || suggestions[key];
    var input = isCompact ? el("input", "field-input") : expandingArea("json-value", IDE.Json.scalarText(value));
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
      var switcher = el("nav", "rendered-switcher");
      ["messages", "tools"].forEach(function (tab) { var tabButton = button(tab.toUpperCase(), IDE.state.renderedTab === tab ? "active" : "", function () { IDE.state.renderedTab = tab; IDE.Rendered.render(); }); switcher.append(tabButton); }); root.append(switcher);
      if (IDE.state.renderedTab === "tools") renderTools(root, data);
      else {
        var title = el("div", "section-title"); title.append(el("h2", "", "Messages"), el("span", "count", messages ? messages.length + " ITEMS" : "NOT AN ARRAY")); root.append(title);
        if (messages) {
          messages.forEach(function (message, index) { root.append(messageCard(message, index, messages)); });
          root.append(button("+ Add message", "secondary", function () { messages.push({ role: "user", content: "" }); commit(); IDE.Rendered.render(); }));
        } else root.append(topField("messages", data.messages));
      }
      var otherKeys = Object.keys(data).filter(function (key) { return key !== "messages" && key !== "tools"; });
      var otherTitle = el("div", "section-title"); otherTitle.style.marginTop = "28px"; otherTitle.append(el("h2", "", "Request fields"), el("span", "count", otherKeys.length + " FIELDS")); root.append(otherTitle);
      otherKeys.forEach(function (key) { root.append(topField(key, data[key])); });
      if (!document.getElementById("role-suggestions")) {
        var list = el("datalist"); list.id = "role-suggestions"; ["system", "tool", "user", "assistant"].forEach(function (v) { var o = el("option"); o.value = v; list.append(o); }); document.body.append(list);
      }
      if (!document.getElementById("part-type-suggestions")) {
        var partTypes = el("datalist"); partTypes.id = "part-type-suggestions"; ["text", "image_url"].forEach(function (v) { var o = el("option"); o.value = v; partTypes.append(o); }); document.body.append(partTypes);
      }
    }
  };
  window.addEventListener("resize", function () {
    document.querySelectorAll("#rendered-editor textarea").forEach(autoSize);
  });
})();
