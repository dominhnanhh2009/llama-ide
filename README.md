# llama-ide

Dùng IDE này để "lập trình với ngôn ngữ llama".

Serve this directory with any static HTTP server and open the resulting URL. The
browser connects directly to llama-server and MCP; both servers must allow CORS
for the IDE origin. The defaults are `http://localhost:3333` for llama-server and
`http://localhost:5555/mcp` for MCP.

MCP discovery appends OpenAI-compatible definitions directly to the working
request's `tools` array and adds the server instructions as the next text part
of its system message. The rendered Tools section edits that array directly;
disabling a tool removes it from the outgoing request while retaining its card
for the current browser session. Returned tool calls are executed through MCP
and their assistant/tool messages are appended to the same working request.
