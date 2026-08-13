(function () {
  "use strict";
  window.LlamaIDE = window.LlamaIDE || {};
  LlamaIDE.state = {
    fileName: "untitled.json",
    fileHandle: null,
    document: { messages: [], model: "default", reasoning_control: true, thinking_budget_tokens: 512, max_tokens: 1024 },
    lastResponse: null,
    responseOpen: false,
    disabledTools: [],
    rawText: "",
    dirty: false,
    activeView: "rendered",
    renderedTab: "messages",
    settings: {
      baseUrl: localStorage.getItem("llamaIde.baseUrl") || "http://localhost:3333",
      mcpUrl: localStorage.getItem("llamaIde.mcpUrl") || "http://localhost:5555/mcp",
      toolLoopLimit: Math.max(1, Math.min(64, Number(localStorage.getItem("llamaIde.toolLoopLimit")) || 8))
    }
  };
  LlamaIDE.setDirty = function (value) {
    LlamaIDE.state.dirty = value;
    var name = document.getElementById("file-name");
    if (name) name.textContent = LlamaIDE.state.fileName + (value ? " •" : "");
  };
})();
