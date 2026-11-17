/**
 * The MCP server's tools, registered directly on the Host.
 *
 * A published bundle cannot aim an MCP row at a file inside itself — the patch
 * would need an absolute path that only works on the machine that built it. So
 * the Host carries the tools itself, and both halves read the same TOOLS array
 * from `mcp-server.mjs`, which means they can never drift apart. Anyone who
 * still prefers the MCP transport can point a `dsh-mcp-client` row at
 * `mcp-server.mjs` by hand.
 */
import { TOOLS } from '../mcp-server.mjs';

/** MCP result -> plain value the tool layer can render. */
function plain(result) {
  const first = Array.isArray(result?.content) ? result.content[0] : null;
  return {
    text: typeof first?.text === 'string' ? first.text : '',
    isError: result?.isError === true,
  };
}

export function sshToolNames() {
  return TOOLS.map((tool) => tool.name);
}

/**
 * @param {object} tools the scoped Tools service (ctx.tools)
 * @returns {string[]} registered names
 */
export function registerSshTools(tools) {
  const registered = [];

  for (const tool of TOOLS) {
    tools.register({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' }, isError: { type: 'boolean' } },
          required: ['text'],
        },
        render(_args, value) {
          const body = typeof value?.text === 'string' ? value.text : '';
          return [{ type: 'text', text: body === '' ? '(no output)' : body }];
        },
      },
      async execute(args) {
        const value = plain(await tool.run(args ?? {}));
        if (value.isError === true) throw new Error(value.text === '' ? `${tool.name} failed` : value.text);
        return value;
      },
    });
    registered.push(tool.name);
  }

  return registered;
}
