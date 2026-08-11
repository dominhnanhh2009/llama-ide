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
    }
  };
})();
