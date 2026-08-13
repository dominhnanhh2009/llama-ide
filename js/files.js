(function () {
  "use strict";
  var IDE = window.LlamaIDE;
  function loadText(text, name, handle) {
    var value = IDE.Json.parse(text); IDE.state.document = value; IDE.state.lastResponse = null; IDE.state.responseOpen = false; IDE.state.rawText = text; IDE.state.fileName = name || "untitled.json"; IDE.state.fileHandle = handle || null; IDE.setDirty(false); IDE.App.refreshAll();
  }
  async function saveWithHandle(handle) {
    var writable = await handle.createWritable(); await writable.write(IDE.Json.pretty(IDE.state.document) + "\n"); await writable.close(); IDE.state.fileHandle = handle; IDE.state.fileName = handle.name; IDE.setDirty(false);
  }
  function download() {
    var blob = new Blob([IDE.Json.pretty(IDE.state.document) + "\n"], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = IDE.state.fileName || "request.json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000); IDE.setDirty(false);
  }
  IDE.Files = {
    newFile: function () { loadText('{\n  "messages": [],\n  "model": "default",\n  "reasoning_control": true,\n  "thinking_budget_tokens": 512,\n  "max_tokens": 1024\n}', "untitled.json", null); IDE.setDirty(true); },
    open: async function () {
      if (window.showOpenFilePicker) {
        var handles = await showOpenFilePicker({ types: [{ description: "JSON request", accept: { "application/json": [".json", ".txt"] } }], multiple: false }); var file = await handles[0].getFile(); loadText(await file.text(), file.name, handles[0]);
      } else document.getElementById("file-input").click();
    },
    openInput: async function (file) { loadText(await file.text(), file.name, null); },
    save: async function () { if (IDE.state.fileHandle) return saveWithHandle(IDE.state.fileHandle); return IDE.Files.saveAs(); },
    saveAs: async function () {
      if (window.showSaveFilePicker) { var handle = await showSaveFilePicker({ suggestedName: IDE.state.fileName, types: [{ description: "JSON request", accept: { "application/json": [".json"] } }] }); return saveWithHandle(handle); }
      download();
    }
  };
})();
