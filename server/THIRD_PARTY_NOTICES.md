# Third-party notices

## bb (https://github.com/get-bb/bb)

The Claude Code ACP client in `src/acp/` mirrors and partly copies code from bb:

| Our file                     | bb source                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `src/acp/acp-client.ts`      | `packages/provider-bridge-acp/src/client/acp-client.ts`, `client/message-stream.ts`        |
| `src/acp/agent-connection.ts`| `packages/provider-bridge-acp/src/bridge/agent-connection.ts`                              |
| `src/acp/claude-session.ts`  | `packages/provider-bridge-acp/src/bridge/bridge.ts` (`startAgentSession`, `stopSession`, `buildPromptContentBlocks`, `pickPermissionOptionId`, `respondPermission`, `handleFsReadTextFile`, `handleFsWriteTextFile`, `authenticateAcpAgent`), `plugins/provider-acp/src/registry.ts` (the `claude-acp` launch command) |
| `src/acp/translate.ts`       | `packages/provider-bridge-acp/src/delta-translation.ts` (`translateUpdate`, `mergeAcpToolCallEvents`, `flushOpenTurnWork`) |

```
MIT License

Copyright (c) 2026 Michael Yong

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
