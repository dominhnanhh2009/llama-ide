(function () {
  "use strict";
  var IDE = window.LlamaIDE;
  var client = null, clientUrl = "";

  async function connectClient(url) {
    if (!url) throw new Error("Enter an MCP Streamable HTTP URL first.");
    if (client && clientUrl === url) return client;
    if (client) await client.close().catch(function () {});
    var sdk = window.McpSdk;
    if (!sdk) throw new Error("The bundled MCP SDK did not load. Refresh the IDE and try again.");
    client = new sdk.Client({ name: "llama-ide", version: "1.0.0" });
    await client.connect(new sdk.StreamableHTTPClientTransport(new URL(url)));
    clientUrl = url;
    return client;
  }

  function openAiTool(tool) {
    return { type: "function", function: { name: tool.name, description: tool.description || "", parameters: tool.inputSchema || { type: "object" } } };
  }

  function toolName(tool) {
    return tool && tool.type === "function" && tool.function && typeof tool.function.name === "string" ? tool.function.name : "";
  }

  function parseArguments(call) {
    var args = call && call.function ? call.function.arguments : {};
    if (typeof args === "string") {
      try { return JSON.parse(args || "{}"); }
      catch (_) { throw new Error("Invalid arguments JSON for " + call.function.name + "."); }
    }
    return args || {};
  }

  function resultText(result) {
    if (result && Array.isArray(result.content)) {
      var texts = result.content.filter(function (part) { return part && part.type === "text" && typeof part.text === "string"; }).map(function (part) { return part.text; });
      if (texts.length) return texts.join("\n");
    }
    return JSON.stringify(result);
  }

  function appendServerInstructions(instructions) {
    if (!instructions || !instructions.trim()) return false;
    if (!Array.isArray(IDE.state.document.messages)) throw new Error("request.messages must be an array before MCP instructions can be appended.");
    var message = IDE.state.document.messages.find(function (item) { return item && item.role === "system"; });
    if (!message) { message = { role: "system", content: [] }; IDE.state.document.messages.unshift(message); }
    if (!Array.isArray(message.content)) {
      var existing = message.content;
      message.content = existing === undefined || existing === null || existing === "" ? [] : [{ type: "text", text: typeof existing === "string" ? existing : JSON.stringify(existing) }];
    }
    var exists = message.content.some(function (part) { return part && part.type === "text" && part.text === instructions.trim(); });
    if (!exists) message.content.push({ type: "text", text: instructions.trim() });
    return !exists;
  }

  IDE.MCP = {
    open: function () {
      document.getElementById("mcp-url").value = IDE.state.settings.mcpUrl;
      document.getElementById("tool-loop-limit").value = IDE.state.settings.toolLoopLimit;
      document.getElementById("settings-dialog").showModal();
    },

    captureForm: function () {
      IDE.state.settings.mcpUrl = document.getElementById("mcp-url").value.trim();
      var limit = Number(document.getElementById("tool-loop-limit").value);
      if (!Number.isInteger(limit) || limit < 1 || limit > 64) throw new Error("Maximum model/tool turns must be an integer from 1 to 64.");
      IDE.state.settings.toolLoopLimit = limit;
      localStorage.setItem("llamaIde.mcpUrl", IDE.state.settings.mcpUrl);
      localStorage.setItem("llamaIde.toolLoopLimit", String(limit));
    },

    connect: async function () {
      var url = document.getElementById("mcp-url").value.trim();
      var button = document.getElementById("mcp-connect");
      button.disabled = true; button.textContent = "Discovering…";
      try {
        if (IDE.state.activeView === "raw") {
          IDE.state.document = IDE.Json.parse(document.getElementById("raw-editor").value);
          IDE.state.rawText = document.getElementById("raw-editor").value;
        }
        var activeClient = await connectClient(url);
        var discovered = (await activeClient.listTools()).tools || [];
        if (IDE.state.document.tools === undefined) IDE.state.document.tools = [];
        if (!Array.isArray(IDE.state.document.tools)) throw new Error("request.tools is not an array. Edit it before discovering MCP tools.");
        var known = {};
        IDE.state.document.tools.forEach(function (tool) { var name = toolName(tool); if (name) known[name] = true; });
        IDE.state.disabledTools.forEach(function (tool) { var name = toolName(tool); if (name) known[name] = true; });
        var added = 0;
        discovered.forEach(function (tool) {
          if (!known[tool.name]) { IDE.state.document.tools.push(openAiTool(tool)); known[tool.name] = true; added += 1; }
        });
        var instructionsAdded = appendServerInstructions(activeClient.getInstructions() || "");
        IDE.state.settings.mcpUrl = url;
        localStorage.setItem("llamaIde.mcpUrl", url);
        IDE.state.rawText = IDE.Json.pretty(IDE.state.document);
        IDE.App.refreshAll(); IDE.setDirty(true);
        document.getElementById("mcp-status").textContent = "Connected · " + added + " tools appended" + (instructionsAdded ? " · instructions appended" : "");
      } finally { button.disabled = false; button.textContent = "Discover tools"; }
    },

    toolCalls: function (message) {
      if (!message) return [];
      if (Array.isArray(message.tool_calls)) return message.tool_calls.filter(function (call) { return call && call.function && call.function.name; });
      if (message.function_call && message.function_call.name) return [{ id: "function_call", type: "function", function: message.function_call }];
      return [];
    },

    call: async function (call) {
      var activeClient = await connectClient(IDE.state.settings.mcpUrl);
      return activeClient.callTool({ name: call.function.name, arguments: parseArguments(call) });
    },

    toolMessage: function (call, result) {
      return { role: "tool", tool_call_id: call.id || call.function.name, name: call.function.name, content: resultText(result) };
    }
  };
})();
