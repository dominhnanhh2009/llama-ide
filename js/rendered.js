(function () {
  "use strict";
  var IDE = window.LlamaIDE;
  var imagePreviewCache = new Map();
  window.addEventListener("unload", function () {
    imagePreviewCache.forEach(function (preview) {
      if (preview.objectUrl) URL.revokeObjectURL(preview.objectUrl);
    });
  });
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
    var minimum = area.classList.contains("tool-description") ? 40 : area.classList.contains("tool-result-content") ? 38 : area.classList.contains("text-content") ? 58 : 72;
    area.style.height = Math.max(area.scrollHeight + 2, minimum) + "px";
  }
  function expandingArea(className, value) {
    var area = el("textarea", className);
    area.value = value;
    area.addEventListener("input", function () { autoSize(area); });
    requestAnimationFrame(function () { autoSize(area); });
    return area;
  }
  var mdInstance = null;
  function getMarkdownRenderer() {
    if (mdInstance) return mdInstance;
    if (typeof window.markdownit !== "function") return null;
    mdInstance = window.markdownit({
      html: true,
      linkify: true,
      typographer: true,
      highlight: function (str, lang) {
        if (typeof hljs !== "undefined" && lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
          } catch (_) {}
        }
        return "";
      }
    });
    if (typeof texmath !== "undefined" && typeof katex !== "undefined") {
      var customBracketDisplay = {
        inline: [
          {
            name: "math_bracket_display",
            rex: /\\\[([\s\S]+?)\\\]/gy,
            tmpl: '<section class="katex-display-inline">$1</section>',
            tag: "\\[",
            displayMode: true
          }
        ]
      };
      mdInstance.use(texmath, {
        engine: katex,
        delimiters: ["dollars", "brackets", customBracketDisplay],
        katexOptions: { macros: { "\\RR": "\\mathbb{R}" }, throwOnError: false }
      });
    }
    return mdInstance;
  }
  function markdownPreview(text) {
    var root = el("div", "markdown-preview");
    var renderer = getMarkdownRenderer();
    if (renderer) {
      root.innerHTML = renderer.render(String(text || ""));
    } else {
      root.textContent = String(text || "");
    }
    var trimmed = root.innerHTML.trim();
    if (!trimmed || trimmed === "<p></p>") {
      root.classList.add("markdown-empty");
      root.dataset.placeholder = "Type Markdown here";
    }
    return root;
  }
  function applyMarkdown(area, value) {
    if (!IDE.state.renderMarkdown) return area;
    area.classList.add("markdown-source-hidden");
    var preview = markdownPreview(value);
    preview.title = "Double-click to edit text";

    function showEditor() {
      area.classList.remove("markdown-source-hidden");
      preview.style.display = "none";
      autoSize(area);
      area.focus();
    }

    function hideEditor() {
      if (!IDE.state.renderMarkdown) return;
      var next = markdownPreview(area.value);
      next.title = "Double-click to edit text";
      next.addEventListener("dblclick", showEditor);
      preview.replaceWith(next);
      preview = next;
      area.classList.add("markdown-source-hidden");
    }

    preview.addEventListener("dblclick", showEditor);
    area.addEventListener("blur", hideEditor);
    area.addEventListener("input", function () {
      if (preview.style.display !== "none") {
        var next = markdownPreview(area.value);
        next.title = "Double-click to edit text";
        next.addEventListener("dblclick", showEditor);
        preview.replaceWith(next);
        preview = next;
      }
    });

    var wrap = el("div", "markdown-editor");
    wrap.append(area, preview);
    return wrap;
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
  function remoteImagePreview(url) {
    var cached = imagePreviewCache.get(url);
    if (cached) return cached.promise;
    var preview = { objectUrl: "", promise: null };
    preview.promise = fetch(url, { mode: "cors" }).then(function (response) {
      if (!response.ok) throw new Error("Image request failed");
      var type = response.headers.get("content-type") || "";
      if (type.indexOf("image/") !== 0) throw new Error("URL is not an image");
      return response.blob();
    }).then(function (blob) {
      preview.objectUrl = URL.createObjectURL(blob);
      return preview.objectUrl;
    }).catch(function () { return ""; });
    imagePreviewCache.set(url, preview);
    return preview.promise;
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
  async function pasteImagesIntoMessage(message, files) {
    var images = files.filter(function (file) { return file && file.type && file.type.indexOf("image/") === 0; });
    if (!images.length) return false;
    var value = message.content;
    if (!Array.isArray(value)) {
      message.content = value === "" || value === null || value === undefined
        ? []
        : [{ type: "text", text: typeof value === "string" ? value : IDE.Json.scalarText(value) }];
    }
    var urls = await Promise.all(images.map(readImage));
    urls.forEach(function (url) { message.content.push({ type: "image_url", image_url: { url: url } }); });
    commit(); IDE.Rendered.render(); IDE.App.notice("Pasted " + images.length + " image" + (images.length === 1 ? "" : "s") + " into this message.");
    return true;
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
      remoteImagePreview(url).then(function (src) {
        frame.replaceChildren();
        if (src) showImage(src, false);
        else showLink(url);
      });
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
      card.append(applyMarkdown(textArea, part.text)); return;
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
      if (!call.function || typeof call.function !== "object" || Array.isArray(call.function)) call.function = {};
      var card = el("div", "tool-call-card"); var head = el("div", "compact-call-head");
      var id = el("input", "compact-call-id"); id.value = call.id || ""; id.placeholder = "call id"; id.addEventListener("input", function () { call.id = id.value; commit(); });
      var name = el("input", "compact-call-name"); name.value = call.function.name || ""; name.placeholder = "tool name"; name.addEventListener("input", function () { call.function.name = name.value; commit(); });
      head.append(el("span", "compact-call-index", "#" + (index + 1)), id, name, button("Remove", "danger-button", function () { calls.splice(index, 1); commit(); IDE.Rendered.render(); }));
      var originalString = typeof call.function.arguments === "string"; var args;
      try { args = originalString ? JSON.parse(call.function.arguments || "{}") : call.function.arguments; }
      catch (_) { args = call.function.arguments; }
      var argsEditor = el("div", "compact-args-editor");
      if (args && typeof args === "object" && !Array.isArray(args)) {
        var argKeys = Object.keys(args);
        if (!argKeys.length) argsEditor.append(el("span", "empty-arguments", "No arguments"));
        argKeys.forEach(function (argKey) {
          var row = el("label", "argument-row"); row.append(el("span", "argument-key", argKey));
          var argValue = args[argKey]; var input = expandingArea("argument-value", "");
          input.value = typeof argValue === "string" ? argValue : JSON.stringify(argValue); input.spellcheck = false;
          requestAnimationFrame(function () { autoSize(input); });
          input.addEventListener("change", function () {
            var next = Object.assign({}, args);
            if (typeof argValue === "string") next[argKey] = input.value;
            else { try { next[argKey] = JSON.parse(input.value); row.classList.remove("invalid"); } catch (_) { row.classList.add("invalid"); return; } }
            args = next; call.function.arguments = originalString ? JSON.stringify(next) : next; commit();
          });
          row.append(input); argsEditor.append(row);
        });
      } else {
        var rawArgs = expandingArea("argument-value argument-raw", typeof args === "string" ? args : JSON.stringify(args)); rawArgs.spellcheck = false; rawArgs.addEventListener("change", function () { call.function.arguments = rawArgs.value; commit(); }); argsEditor.append(rawArgs);
      }
      card.append(head, argsEditor); group.append(card);
    });
    body.append(group);
  }
  function toolResultContent(message, body) {
    if (Array.isArray(message.content)) {
      contentEditor(message, "content", body);
      return;
    }
    var area = expandingArea("tool-result-content", IDE.Json.scalarText(message.content)); area.spellcheck = true;
    area.placeholder = "Tool result content";
    area.addEventListener("input", function () { try { message.content = IDE.Json.parseScalarText(area.value, message.content); commit(); } catch (_) {} });
    body.append(area);
  }
  function messageRoleClass(role) {
    return ["assistant", "user", "system", "tool"].indexOf(role) !== -1 ? " role-" + role : " role-other";
  }
  function contentEditor(message, key, body) {
    var group = el("div", "content-group" + (key === "reasoning_content" ? " reasoning-content-group" : ""));
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
      var draggedIndex = null;
      value.forEach(function (part, partIndex) {
        var card = el("div", "part-card");
        if (!part || typeof part !== "object" || Array.isArray(part)) { part = { type: "text", text: IDE.Json.scalarText(part) }; value[partIndex] = part; }
        var tools = el("div", "part-toolbar");
        var handle = el("span", "part-drag-handle", ""); handle.draggable = true; handle.title = "Drag to move this part"; handle.setAttribute("role", "button"); handle.setAttribute("aria-label", "Move part " + (partIndex + 1));
        handle.addEventListener("dragstart", function (event) { draggedIndex = partIndex; card.classList.add("part-dragging"); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(partIndex)); });
        handle.addEventListener("dragend", function () { draggedIndex = null; card.classList.remove("part-dragging"); group.querySelectorAll(".part-card").forEach(function (item) { item.classList.remove("part-drop-before", "part-drop-after"); }); });
        tools.append(handle, el("span", "", "PART " + (partIndex + 1)));
        var typeWrap = el("label", "part-type-label", "TYPE"); var typeInput = el("input", "part-type-input"); typeInput.value = typeof part.type === "string" ? part.type : ""; typeInput.setAttribute("list", "part-type-suggestions");
        typeInput.addEventListener("change", function () { changePartType(part, typeInput.value.trim()); }); typeWrap.append(typeInput); tools.append(typeWrap);
        tools.append(button("Remove", "danger-button", function () { value.splice(partIndex, 1); commit(); IDE.Rendered.render(); }));
        card.addEventListener("dragover", function (event) {
          if (draggedIndex === null || draggedIndex === partIndex) return;
          event.preventDefault(); event.dataTransfer.dropEffect = "move";
          var after = event.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
          card.classList.toggle("part-drop-before", !after); card.classList.toggle("part-drop-after", after);
        });
        card.addEventListener("dragleave", function () { card.classList.remove("part-drop-before", "part-drop-after"); });
        card.addEventListener("drop", function (event) {
          if (draggedIndex === null || draggedIndex === partIndex) return;
          event.preventDefault(); var after = event.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
          var moved = value.splice(draggedIndex, 1)[0]; var target = partIndex + (after ? 1 : 0); if (draggedIndex < target) target -= 1;
          value.splice(target, 0, moved); draggedIndex = null; commit(); IDE.Rendered.render();
        });
        card.append(tools); renderPart(part, card); enablePartDrop(card, part); group.append(card);
      });
    } else {
      var area = expandingArea("text-content", IDE.Json.scalarText(value)); area.spellcheck = true;
      area.addEventListener("input", function () { try { message[key] = IDE.Json.parseScalarText(area.value, value); commit(); } catch (_) { /* preserve draft until valid */ } });
      group.append(typeof value === "string" ? applyMarkdown(area, value) : area);
    }
    body.append(group);
  }
  var draggedMessageIndex = null;
  function messageCard(message, index, messages) {
    var isToolResult = message && message.role === "tool"; var card = el("article", "message-card" + messageRoleClass(message && message.role) + (isToolResult ? " tool-result-card" : ""));
    var head = el("div", "message-head");
    var handle = el("span", "message-drag-handle", ""); handle.draggable = true; handle.title = "Drag to reorder this message"; handle.setAttribute("role", "button"); handle.setAttribute("aria-label", "Move message " + (index + 1));
    handle.addEventListener("dragstart", function (event) { draggedMessageIndex = index; card.classList.add("message-dragging"); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index)); });
    handle.addEventListener("dragend", function () { draggedMessageIndex = null; card.classList.remove("message-dragging"); document.querySelectorAll("#rendered-editor .message-card").forEach(function (item) { item.classList.remove("message-drop-before", "message-drop-after"); }); });
    card.addEventListener("dragover", function (event) {
      if (draggedMessageIndex === null || draggedMessageIndex === index) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      var after = event.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
      card.classList.toggle("message-drop-before", !after); card.classList.toggle("message-drop-after", after);
    });
    card.addEventListener("dragleave", function () { card.classList.remove("message-drop-before", "message-drop-after"); });
    card.addEventListener("drop", function (event) {
      if (draggedMessageIndex === null || draggedMessageIndex === index) return;
      event.preventDefault(); var after = event.clientY > card.getBoundingClientRect().top + card.offsetHeight / 2;
      var moved = messages.splice(draggedMessageIndex, 1)[0]; var target = index + (after ? 1 : 0); if (draggedMessageIndex < target) target -= 1;
      messages.splice(target, 0, moved); draggedMessageIndex = null; commit(); IDE.Rendered.render();
    });
    head.append(handle, el("span", "drag-index", "#" + (index + 1)));
    var role = el("input", "role-input"); role.value = message.role === undefined ? "" : String(message.role); role.setAttribute("list", "role-suggestions"); role.placeholder = "role";
    role.addEventListener("input", function () {
      message.role = role.value; card.className = "message-card" + messageRoleClass(role.value) + (role.value === "tool" ? " tool-result-card" : ""); commit();
    });
    head.append(role);
    if (isToolResult) {
      var callId = el("input", "tool-result-id"); callId.value = message.tool_call_id || ""; callId.placeholder = "tool_call_id"; callId.addEventListener("input", function () { message.tool_call_id = callId.value; commit(); });
      var toolName = el("input", "tool-result-name"); toolName.value = message.name || ""; toolName.placeholder = "tool name"; toolName.addEventListener("input", function () { message.name = toolName.value; commit(); });
      head.append(callId, toolName);
    }
    head.append(el("span", "spacer"), button("Remove message", "danger-button", function () { messages.splice(index, 1); commit(); IDE.Rendered.render(); }));
    var body = el("div", "message-body");
    body.addEventListener("paste", function (event) {
      var items = event.clipboardData && event.clipboardData.items ? Array.prototype.slice.call(event.clipboardData.items) : [];
      var files = items.filter(function (item) { return item.kind === "file" && item.type.indexOf("image/") === 0; }).map(function (item) { return item.getAsFile(); }).filter(Boolean);
      if (!files.length) return;
      event.preventDefault(); IDE.App.safe(function () { return pasteImagesIntoMessage(message, files); });
    });
    if (isToolResult && "content" in message) toolResultContent(message, body);
    var messageKeys = Object.keys(message);
    if (messageKeys.indexOf("reasoning_content") !== -1) {
      messageKeys = ["reasoning_content"].concat(messageKeys.filter(function (key) { return key !== "reasoning_content"; }));
    }
    messageKeys.forEach(function (key) {
      if (key === "role" || (isToolResult && (key === "tool_call_id" || key === "name" || key === "content"))) return;
      if (key === "content" && Array.isArray(message.tool_calls) && (message.content === null || message.content === "")) return;
      if (key === "content" || key === "reasoning_content") contentEditor(message, key, body);
      else if (key === "tool_calls" && Array.isArray(message[key])) toolCallsEditor(message, key, body);
      else {
        var group = el("div", "content-group"); group.append(el("div", "field-label", key));
        var area = expandingArea("json-value", IDE.Json.scalarText(message[key]));
        area.addEventListener("change", function () { try { message[key] = IDE.Json.parseScalarText(area.value, message[key]); group.classList.remove("invalid"); commit(); } catch (_) { group.classList.add("invalid"); } });
        group.append(area); body.append(group);
      }
    });
    var addFields = el("div", "content-group add-fields");
    if (!("content" in message)) addFields.append(button("+ content", "mini-button", function () { message.content = ""; commit(); IDE.Rendered.render(); }));
    if (!("reasoning_content" in message) && !Array.isArray(message.tool_calls)) addFields.append(button("+ reasoning_content", "mini-button", function () { message.reasoning_content = ""; commit(); IDE.Rendered.render(); }));
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
    var summary = el("span", "tool-summary", tool.function && tool.function.name ? tool.function.name : "Unnamed tool");
    toggle.addEventListener("change", function () {
      var name = tool.function && tool.function.name;
      if (!name) return;
      var at = IDE.state.disabledTools.indexOf(name);
      if (toggle.checked && at !== -1) IDE.state.disabledTools.splice(at, 1);
      else if (!toggle.checked && at === -1) IDE.state.disabledTools.push(name);
      commit(); showToolsDialog();
    });
    head.append(enabledLabel, el("span", "drag-index", "#" + (index + 1)), summary, el("span", "spacer"), button("Remove", "danger-button", function () { collection.splice(index, 1); commit(); showToolsDialog(); }));
    var body = el("div", "tool-config-body"); var fn = tool.function || {};
    var type = el("input"); type.value = tool.type === undefined ? "" : String(tool.type); type.addEventListener("input", function () { tool.type = type.value; commit(); });
    var name = el("input"); name.value = fn.name === undefined ? "" : String(fn.name); name.placeholder = "Tool name"; name.addEventListener("input", function () { fn.name = name.value; summary.textContent = name.value || "Unnamed tool"; commit(); });
    var description = expandingArea("tool-description", fn.description === undefined ? "" : String(fn.description)); description.placeholder = "What does this tool do?"; description.addEventListener("input", function () { fn.description = description.value; commit(); });
    body.append(toolField("Type", type), toolField("Name", name), toolField("Description", description, "full-width"));
    if (fn.parameters && fn.parameters.type === "object" && typeof fn.parameters.properties === "object") {
      var params = el("div", "parameters-config full-width");
      var pHead = el("div", "parameters-head");
      pHead.append(el("span", "field-label", "PARAMETERS (OBJECT)"), button("+ Add parameter", "mini-button", function () {
        var key = "param_" + (Object.keys(fn.parameters.properties).length + 1);
        fn.parameters.properties[key] = { type: "string", description: "" }; commit(); showToolsDialog();
      }));
      params.append(pHead);
      var propKeys = Object.keys(fn.parameters.properties);
      if (!Array.isArray(fn.parameters.required)) fn.parameters.required = [];
      propKeys.forEach(function (propertyName) {
        var schema = fn.parameters.properties[propertyName] || {};
        var row = el("div", "parameter-row");
        var nameWrap = el("div", "parameter-name");
        var propInput = el("input"); propInput.value = propertyName; propInput.placeholder = "property_name";
        var star = el("span", "required-star" + (fn.parameters.required.indexOf(propertyName) !== -1 ? " active" : ""), "*");
        nameWrap.append(propInput, star);
        var typeInput = el("input"); typeInput.value = schema.type || "string"; typeInput.placeholder = "type";
        var descInput = expandingArea("parameter-description", schema.description || ""); descInput.placeholder = "Parameter description";
        var reqLabel = el("label", "parameter-required"); var requiredInput = el("input"); requiredInput.type = "checkbox"; requiredInput.checked = fn.parameters.required.indexOf(propertyName) !== -1;
        reqLabel.append(requiredInput, el("span", "", "Required"));
        propInput.addEventListener("change", function () {
          var nextName = propInput.value.trim();
          if (!nextName || nextName === propertyName) return;
          var saved = fn.parameters.properties[propertyName]; delete fn.parameters.properties[propertyName]; fn.parameters.properties[nextName] = saved;
          var at = fn.parameters.required.indexOf(propertyName); if (at !== -1) fn.parameters.required[at] = nextName;
          commit(); showToolsDialog();
        });
        typeInput.addEventListener("input", function () { schema.type = typeInput.value; commit(); });
        descInput.addEventListener("input", function () { schema.description = descInput.value; commit(); });
        requiredInput.addEventListener("change", function () {
          var at = fn.parameters.required.indexOf(propertyName);
          if (requiredInput.checked && at === -1) fn.parameters.required.push(propertyName);
          else if (!requiredInput.checked && at !== -1) fn.parameters.required.splice(at, 1);
          star.classList.toggle("active", requiredInput.checked); commit();
        });
        row.append(nameWrap, typeInput, reqLabel, button("×", "danger-button", function () {
          delete fn.parameters.properties[propertyName]; var at = fn.parameters.required.indexOf(propertyName); if (at !== -1) fn.parameters.required.splice(at, 1); commit(); showToolsDialog();
        }), descInput);
        params.append(row);
      });
      if (!propKeys.length) params.append(el("div", "empty-state parameter-empty", "No parameters configured. Click + Add parameter."));
      body.append(params);
    }
    card.append(head, body); return card;
  }
  function showToolsDialog() {
    var existing = document.getElementById("tools-config-dialog"); if (existing) existing.remove();
    var data = IDE.state.document; var tools = Array.isArray(data.tools) ? data.tools : [];
    var dialog = el("dialog", "tools-dialog"); dialog.id = "tools-config-dialog";
    var head = el("div", "dialog-head");
    var heading = el("div"); heading.append(el("span", "eyebrow", "REQUEST TOOLS"), el("h2", "", "Configure Tools (" + tools.length + ")"));
    var closeBtn = button("×", "icon-button", function () { dialog.close(); });
    closeBtn.setAttribute("aria-label", "Close");
    head.append(heading, closeBtn);
    var content = el("div", "tools-dialog-content");
    var grid = el("div", "tools-grid");
    tools.forEach(function (tool, index) {
      var name = tool.function && tool.function.name; var enabled = IDE.state.disabledTools.indexOf(name) === -1;
      grid.append(toolCard(tool, index, tools, enabled));
    });
    content.append(grid);
    if (!tools.length) content.append(el("div", "empty-state", "No tools defined in this request."));
    var actions = el("div", "dialog-actions");
    if (tools.length) {
      actions.append(button("Clear all", "danger-button", function () {
        if (Array.isArray(data.tools)) data.tools.length = 0; IDE.state.disabledTools.length = 0; commit(); showToolsDialog();
      }));
    }
    actions.append(
      button("+ Add tool", "secondary", function () { if (!Array.isArray(data.tools)) data.tools = []; data.tools.push({ type: "function", function: { name: "custom_tool", description: "", parameters: { type: "object", properties: {} } } }); commit(); showToolsDialog(); }),
      button("Done", "primary", function () { dialog.close(); })
    );
    content.append(actions);
    dialog.append(head, content);
    dialog.addEventListener("click", function (event) {
      var rect = dialog.getBoundingClientRect();
      var isInDialog = (rect.top <= event.clientY && event.clientY <= rect.top + rect.height && rect.left <= event.clientX && event.clientX <= rect.left + rect.width);
      if (!isInDialog) dialog.close();
    });
    dialog.addEventListener("close", function () {
      dialog.remove();
      IDE.Rendered.render();
    });
    document.body.append(dialog); dialog.showModal();
  }
  function getOptionsForField(key) {
    if (key === "model") {
      var modelList = document.getElementById("model-suggestions");
      if (modelList && modelList.children.length) {
        return Array.prototype.map.call(modelList.children, function (opt) {
          return { value: opt.value, label: opt.label || "" };
        }).filter(function (opt) { return Boolean(opt.value); });
      }
      return [];
    }
    var preset = {
      reasoning_control: ["true", "false"], stream: ["true", "false"], backend_sampling: ["true", "false"],
      return_progress: ["true", "false"], timings_per_token: ["true", "false"], reasoning_format: ["auto", "none", "deepseek"],
      temperature: ["0", "0.2", "0.7", "0.8", "1", "1.2"], repeat_penalty: ["1", "1.05", "1.1", "1.2"],
      thinking_budget_tokens: ["0", "256", "512", "1024", "2048", "-1"], max_tokens: ["-1", "256", "512", "1024", "2048", "4096"]
    };
    if (preset[key]) {
      return preset[key].map(function (item) { return { value: item, label: "" }; });
    }
    return null;
  }
  function topField(key, value) {
    var card = el("div", "field-card"); card.append(el("div", "field-label", key));
    if (key === "chat_template_kwargs" && value && typeof value === "object" && !Array.isArray(value)) {
      card.querySelector(".field-label").textContent = "chat_template_kwargs.enable_thinking";
      var thinking = el("select", "field-input");
      ["true", "false"].forEach(function (item) { var option = el("option", "", item); option.value = item; thinking.append(option); });
      thinking.value = value.enable_thinking === false ? "false" : "true";
      thinking.addEventListener("change", function () { value.enable_thinking = thinking.value === "true"; commit(); });
      card.append(thinking); return card;
    }
    var options = getOptionsForField(key);
    var isCompact = key === "model" || Boolean(options);
    if (!isCompact) {
      var editor = jsonEditor(value, function (next) { IDE.state.document[key] = next; card.classList.remove("invalid"); commit(); });
      card.append(editor);
      return card;
    }
    var input = el("input", "field-input");
    input.value = IDE.Json.scalarText(value);
    function updateVal(val) {
      try {
        IDE.state.document[key] = IDE.Json.parseScalarText(val, value);
        card.classList.remove("invalid");
        commit();
        if (key === "model") IDE.Server.loadSlots();
      } catch (error) {
        card.classList.add("invalid");
        IDE.App.notice(key + ": " + error.message);
      }
    }
    input.addEventListener("change", function () { updateVal(input.value); });
    if (options) {
      var comboWrap = el("div", "field-combo");
      var arrowBtn = el("button", "combo-arrow-btn", "▾");
      arrowBtn.type = "button";
      arrowBtn.title = "Show all options";
      arrowBtn.setAttribute("aria-label", "Show all options for " + key);
      var menu = el("div", "combo-menu");
      function populateMenu() {
        menu.replaceChildren();
        var currentOpts = getOptionsForField(key) || [];
        if (!currentOpts.length) {
          menu.append(el("div", "empty-state", "No suggestions available"));
          return;
        }
        currentOpts.forEach(function (optItem) {
          var optBtn = el("button", "combo-option" + (input.value === optItem.value ? " selected" : ""));
          optBtn.type = "button";
          optBtn.textContent = optItem.value;
          if (optItem.label && optItem.label !== optItem.value) {
            optBtn.append(el("span", "combo-option-label", optItem.label));
          }
          optBtn.addEventListener("mousedown", function (e) {
            e.preventDefault();
            input.value = optItem.value;
            updateVal(optItem.value);
            closeMenu();
          });
          menu.append(optBtn);
        });
      }
      function openMenu() {
        document.querySelectorAll(".combo-menu.open").forEach(function (m) {
          if (m !== menu) m.classList.remove("open");
        });
        populateMenu();
        menu.classList.add("open");
      }
      function closeMenu() {
        menu.classList.remove("open");
      }
      arrowBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (menu.classList.contains("open")) closeMenu();
        else openMenu();
      });
      document.addEventListener("click", function (e) {
        if (!comboWrap.contains(e.target)) closeMenu();
      });
      comboWrap.append(input, arrowBtn, menu);
      card.append(comboWrap);
      return card;
    }
    card.append(input);
    return card;
  }
  function renderRequestFields(host, data) {
    host.replaceChildren();
    var otherKeys = Object.keys(data).filter(function (key) { return key !== "messages" && key !== "tools"; });
    var head = el("div", "side-fields-head"); head.append(el("span", "eyebrow", "REQUEST"), el("span", "count", otherKeys.length + " FIELDS")); host.append(head);
    var fields = el("div", "request-fields");
    function appendRow(className, keys) {
      var present = keys.filter(function (key) { return otherKeys.indexOf(key) !== -1; });
      if (!present.length) return;
      var row = el("div", "request-field-row " + className);
      present.forEach(function (key) { row.append(topField(key, data[key])); }); fields.append(row);
    }
    appendRow("model-sampling-row", ["model", "temperature", "repeat_penalty"]);
    appendRow("reasoning-row", ["reasoning_control", "chat_template_kwargs", "thinking_budget_tokens"]);
    var grouped = ["model", "temperature", "repeat_penalty", "reasoning_control", "chat_template_kwargs", "thinking_budget_tokens", "max_tokens"];
    otherKeys.filter(function (key) { return grouped.indexOf(key) === -1; }).forEach(function (key) { fields.append(topField(key, data[key])); });
    appendRow("max-tokens-row", ["max_tokens"]); host.append(fields);
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
      var fieldsHost = document.getElementById("request-fields-host"); if (fieldsHost) renderRequestFields(fieldsHost, data);
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
