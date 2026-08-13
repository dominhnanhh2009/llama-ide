(function () {
  "use strict";
  var IDE = window.LlamaIDE;
  IDE.Json = {
    pretty: function (value) { return JSON.stringify(value, null, 2); },
    parse: function (text) {
      var value = JSON.parse(text);
      if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("The request root must be a JSON object.");
      return value;
    },
    scalarText: function (value) {
      return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    },
    parseScalarText: function (text, original) {
      if (typeof original === "string") return text;
      return JSON.parse(text);
    },
    highlight: function (root, value) {
      var text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      var pattern = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"\s*:)|("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)/g;
      var fragment = document.createDocumentFragment(); var last = 0; var match;
      while ((match = pattern.exec(text))) {
        fragment.append(document.createTextNode(text.slice(last, match.index)));
        var token = document.createElement("span");
        token.className = "json-token json-" + (match[1] ? "key" : match[2] ? "string" : match[3] ? "number" : match[4] ? "boolean" : "null");
        token.textContent = match[0]; fragment.append(token); last = pattern.lastIndex;
      }
      fragment.append(document.createTextNode(text.slice(last))); root.replaceChildren(fragment);
    }
  };
})();
