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
    var minimum = area.classList.contains("tool-description") ? 40 : 78;
    area.style.height = Math.max(area.scrollHeight + 2, minimum) + "px";
  }
  function expandingArea(className, value) {
    var area = el("textarea", className);
    area.value = value;
    area.addEventListener("input", function () { autoSize(area); });
    requestAnimationFrame(function () { autoSize(area); });
    return area;
  }
  function jsonEditor(value, onChange) {
    var frame = el("div", "json-editor"); var highlight = el("pre", "json-highlight");
    var area = el("textarea", "json-input"); area.spellcheck = false; area.value = IDE.Json.pretty(value);
    function paint() { IDE.Json.highlight(highlight, area.value); }
    function size() { area.style.height = "0"; area.style.height = Math.max(area.scrollHeight + 2, 92) + "px"; highlight.style.height = area.style.height; }
    area.addEventListener("input", function () { paint(); size(); frame.classList.remove("invalid"); });
    area.addEventListener("scroll", function () { highlight.scrollTop = area.scrollTop; highlight.scrollLeft = area.scrollLeft; });
    area.addEventListener("change", function () {
      try { onChange(JSON.parse(area.value)); frame.classList.remove("invalid"); }
      catch (error) { frame.classList.add("invalid"); IDE.App.notice(error.message); }
    });
    frame.append(highlight, area); paint(); requestAnimationFrame(size); return frame;
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
  function toolCallsEditor(message, key, body) {
    var group = el("div", "content-group"); var calls = message[key]; var title = el("div", "field-label"); title.append(el("span", "", key), button("+ Tool call", "mini-button", function () { calls.push({ id: "", type: "function", function: { name: "", arguments: "{}" } }); commit(); IDE.Rendered.render(); })); group.append(title);
    calls.forEach(function (call, index) {
      if (!call || typeof call !== "object" || Array.isArray(call)) call = calls[index] = { id: "", type: "function", function: { name: "", arguments: "{}" } };
      var card = el("div", "tool-call-card"); var head = el("div", "json-card-head");
      head.append(el("span", "drag-index", "CALL " + (index + 1)), button("Remove", "danger-button", function () { calls.splice(index, 1); commit(); IDE.Rendered.render(); }));
      card.append(head, jsonEditor(call, function (next) {
        if (!next || typeof next !== "object" || Array.isArray(next)) throw new Error("A tool call must be a JSON object.");
        calls[index] = next; commit();
      })); group.append(card);
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
      commit(); showToolsDialog();
    });
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) tool = collection[index] = { type: "function", function: { name: "", description: "", parameters: { type: "object", properties: {} } } };
    if (!tool.function || typeof tool.function !== "object" || Array.isArray(tool.function)) tool.function = {};
    var fn = tool.function;
    if (!fn.parameters || typeof fn.parameters !== "object" || Array.isArray(fn.parameters)) fn.parameters = { type: "object", properties: {} };
    if (!fn.parameters.properties || typeof fn.parameters.properties !== "object" || Array.isArray(fn.parameters.properties)) fn.parameters.properties = {};
    if (!Array.isArray(fn.parameters.required)) fn.parameters.required = [];
    var summary = el("strong", "tool-summary", fn.name || "Unnamed tool");
    head.append(enabledLabel, el("span", "drag-index", "#" + (index + 1)), summary, el("span", "spacer"), button("Remove", "danger-button", function () { collection.splice(index, 1); commit(); showToolsDialog(); }));
    var body = el("div", "tool-config-body");
    var type = el("input"); type.value = tool.type === undefined ? "" : String(tool.type); type.addEventListener("input", function () { tool.type = type.value; commit(); });
    var name = el("input"); name.value = fn.name === undefined ? "" : String(fn.name); name.placeholder = "Tool name"; name.addEventListener("input", function () { fn.name = name.value; summary.textContent = name.value || "Unnamed tool"; commit(); });
    var description = expandingArea("tool-description", fn.description === undefined ? "" : String(fn.description)); description.placeholder = "What does this tool do?"; description.addEventListener("input", function () { fn.description = description.value; commit(); });
    body.append(toolField("Type", type), toolField("Name", name), toolField("Description", description, "full-width"));
    var parameters = el("section", "parameters-config full-width");
    var parameterHead = el("div", "parameters-head"); parameterHead.append(el("div", "field-label", "Parameters"), button("+ Parameter", "mini-button", function () {
      var n = 1, key = "parameter"; while (key in fn.parameters.properties) { n += 1; key = "parameter" + n; }
      fn.parameters.properties[key] = { type: "string", description: "" }; commit(); showToolsDialog();
    })); parameters.append(parameterHead);
    var propertyNames = Object.keys(fn.parameters.properties);
    if (!propertyNames.length) parameters.append(el("p", "empty-state parameter-empty", "This tool has no parameters."));
    propertyNames.forEach(function (propertyName) {
      var schema = fn.parameters.properties[propertyName];
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) schema = fn.parameters.properties[propertyName] = { type: String(schema || "string"), description: "" };
      var row = el("div", "parameter-row"); var nameWrap = el("label", "parameter-name");
      var required = fn.parameters.required.indexOf(propertyName) !== -1;
      var nameInput = el("input"); nameInput.value = propertyName; nameInput.placeholder = "Parameter name";
      var star = el("span", "required-star" + (required ? " active" : ""), "*"); nameWrap.append(nameInput, star);
      var typeInput = el("input"); typeInput.value = schema.type === undefined ? "" : String(schema.type); typeInput.placeholder = "type";
      var descInput = el("textarea", "parameter-description"); descInput.value = schema.description === undefined ? "" : String(schema.description); descInput.placeholder = "Parameter description";
      var requiredLabel = el("label", "parameter-required"); var requiredInput = el("input"); requiredInput.type = "checkbox"; requiredInput.checked = required; requiredLabel.append(requiredInput, el("span", "", "Required"));
      nameInput.addEventListener("change", function () {
        var nextName = nameInput.value.trim(); if (!nextName || nextName === propertyName || nextName in fn.parameters.properties) { nameInput.value = propertyName; return; }
        fn.parameters.properties[nextName] = schema; delete fn.parameters.properties[propertyName];
        var requiredIndex = fn.parameters.required.indexOf(propertyName); if (requiredIndex !== -1) fn.parameters.required[requiredIndex] = nextName;
        commit(); showToolsDialog();
      });
      typeInput.addEventListener("input", function () { schema.type = typeInput.value; commit(); });
      descInput.addEventListener("input", function () { schema.description = descInput.value; commit(); });
      requiredInput.addEventListener("change", function () {
        var at = fn.parameters.required.indexOf(propertyName);
        if (requiredInput.checked && at === -1) fn.parameters.required.push(propertyName);
        if (!requiredInput.checked && at !== -1) fn.parameters.required.splice(at, 1);
        star.classList.toggle("active", requiredInput.checked); commit();
      });
      row.append(nameWrap, typeInput, descInput, requiredLabel, button("Remove", "danger-button", function () {
        delete fn.parameters.properties[propertyName]; var at = fn.parameters.required.indexOf(propertyName); if (at !== -1) fn.parameters.required.splice(at, 1); commit(); showToolsDialog();
      })); parameters.append(row);
    });
    body.append(parameters); card.append(head, body); return card;
  }
  function renderTools(root, data) {
    var tools = Array.isArray(data.tools) ? data.tools : null; var disabled = IDE.state.disabledTools;
    var total = (tools ? tools.length : 0) + disabled.length;
    var title = el("div", "section-title"); title.append(el("h2", "", "Tools"), el("span", "count", (tools ? tools.length : 0) + " ENABLED · " + total + " TOTAL")); root.append(title);
    if (!tools && data.tools !== undefined) {
      var invalidCard = el("div", "field-card invalid"); invalidCard.append(el("div", "field-label", "Tools must be an array"), el("p", "empty-state", "Fix the tools value in Raw request before configuring it here.")); root.append(invalidCard);
    }
    else {
      var grid = el("div", "tools-grid");
      (tools || []).forEach(function (tool, index) { grid.append(toolCard(tool, index, tools, true)); });
      disabled.forEach(function (tool, index) { grid.append(toolCard(tool, index, disabled, false)); });
      root.append(grid);
      root.append(button("+ Add tool", "secondary", function () { if (!Array.isArray(data.tools)) data.tools = []; data.tools.push({ type: "function", function: { name: "", description: "", parameters: { type: "object", properties: {} } } }); commit(); showToolsDialog(); }));
    }
  }
  function showToolsDialog() {
    var previous = document.getElementById("tools-dialog"); if (previous) previous.remove();
    var dialog = el("dialog", "tools-dialog"); dialog.id = "tools-dialog";
    var head = el("div", "dialog-head"); var heading = el("div"); heading.append(el("span", "eyebrow", "REQUEST TOOLS"), el("h2", "", "Configure tools"));
    head.append(heading, button("×", "icon-button", function () { dialog.close(); }));
    var content = el("div", "tools-dialog-content"); renderTools(content, IDE.state.document);
    dialog.append(head, content); document.body.append(dialog); dialog.showModal();
  }
  function topField(key, value) {
    var card = el("div", "field-card"); card.append(el("div", "field-label", key));
    var suggestions = {
      reasoning_control: ["true", "false"], stream: ["true", "false"], backend_sampling: ["true", "false"],
      return_progress: ["true", "false"], timings_per_token: ["true", "false"], reasoning_format: ["auto", "none", "deepseek"],
      thinking_budget_tokens: ["0", "256", "512", "1024", "2048", "-1"], max_tokens: ["256", "512", "1024", "2048", "4096", "-1"]
    };
    var isCompact = key === "model" || suggestions[key];
    var input = isCompact ? el("input", "field-input") : jsonEditor(value, function (next) { IDE.state.document[key] = next; card.classList.remove("invalid"); commit(); });
    if (!isCompact) { card.append(input); return card; }
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
      {
        var title = el("div", "section-title"); var titleActions = el("div", "section-title-actions");
        var toolCount = Array.isArray(data.tools) ? data.tools.length : 0;
        titleActions.append(el("span", "count", messages ? messages.length + " ITEMS" : "NOT AN ARRAY"), button("Configure tools (" + toolCount + ")", "secondary configure-tools-button", showToolsDialog));
        title.append(el("h2", "", "Messages"), titleActions); root.append(title);
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
