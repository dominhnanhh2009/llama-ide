(function () {
  "use strict";
  window.LlamaIDE = window.LlamaIDE || {};
  LlamaIDE.state = {
    fileName: "untitled.json",
    fileHandle: null,
    document: { messages: [], model: "default", reasoning_control: true, thinking_budget_tokens: 512, max_tokens: 1024 },
    lastResponse: null,
    responseOpen: false,
    rawText: "",
    dirty: false,
    activeView: "rendered",
    settings: { baseUrl: localStorage.getItem("llamaIde.baseUrl") || "http://localhost:3333" }
  };
  LlamaIDE.setDirty = function (value) {
    LlamaIDE.state.dirty = value;
    var name = document.getElementById("file-name");
    if (name) name.textContent = LlamaIDE.state.fileName + (value ? " •" : "");
  };
})();
