import type { PluginModule } from "@opencode-ai/plugin"
import { createPluginModule } from "./testing/create-plugin-module"

const pluginModule: PluginModule = createPluginModule()

export const omoPlugin = pluginModule.server

// V2 bridge: add setup function for OpenCode V2 compatibility
// V2 hosts look for `setup(ctx)` on the default export
pluginModule.setup = async (ctx: any) => {
  const directory = (ctx.app && ctx.app.directory) || process.cwd()
  const v1Input: any = {
    client: {
      session: {
        messages: async () => ({ parts: [] }),
        get: async () => ({}),
        status: async () => ({ agents: [] }),
      },
    },
    project: (ctx.app && ctx.app.project) || {},
    directory: directory,
    worktree: directory,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:3000"),
    $: { exec: async () => ({ stdout: "", stderr: "", code: 0 }) },
  }
  try {
    const hooks = await pluginModule.server!(v1Input, {})
    if (hooks["session.start"]) {
      try { ctx.session?.on?.("start", hooks["session.start"]) } catch (e) {}
    }
    if (hooks["session.end"]) {
      try { ctx.session?.on?.("end", hooks["session.end"]) } catch (e) {}
    }
    if (hooks["agent.transform"]) {
      try { ctx.agent?.transform?.(hooks["agent.transform"]) } catch (e) {}
    }
    if (hooks["tool.execute.before"]) {
      try { ctx.tool?.execute?.before?.(hooks["tool.execute.before"]) } catch (e) {}
    }
    if (hooks["tool.execute.after"]) {
      try { ctx.tool?.execute?.after?.(hooks["tool.execute.after"]) } catch (e) {}
    }
    if (hooks["command.execute.before"]) {
      try { ctx.command?.execute?.before?.(hooks["command.execute.before"]) } catch (e) {}
    }
    if (hooks["command.execute.after"]) {
      try { ctx.command?.execute?.after?.(hooks["command.execute.after"]) } catch (e) {}
    }
  } catch (e) {
    console.error("[omo-v2-bridge] setup error:", e instanceof Error ? e.message : String(e))
  }

  // V2 MCP registration: register builtin MCP servers (websearch, context7, grep_app, lsp)
  const BUILTIN_MCPS: Record<string, any> = {}
  try {
    // context7
    const ctx7Key = process.env.CONTEXT7_API_KEY
    BUILTIN_MCPS.context7 = {
      type: "remote", url: "https://mcp.context7.com/mcp", oauth: false,
      ...(ctx7Key?.trim() ? { headers: { Authorization: `Bearer ${ctx7Key.trim()}` } } : {}),
    }
    // grep_app
    BUILTIN_MCPS.grep_app = { type: "remote", url: "https://mcp.grep.app", oauth: false }
    // websearch (exa)
    const exaKey = process.env.EXA_API_KEY
    BUILTIN_MCPS.websearch = {
      type: "remote", url: "https://mcp.exa.ai/mcp?tools=web_search_exa", oauth: false,
      ...(exaKey?.trim() ? { headers: { Authorization: `Bearer ${exaKey.trim()}` } } : {}),
    }
    // lsp (disabled if daemon not available)
    const lspDaemon = process.env.OMO_LSP_DAEMON_CLI
    BUILTIN_MCPS.lsp = {
      type: "local",
      command: (lspDaemon && lspDaemon.length > 0) ? [lspDaemon, "mcp"] : ["node", "-e", "process.exit(1)"],
      disabled: !(lspDaemon && lspDaemon.length > 0),
    }

    await ctx.mcp?.transform?.((editor: any) => {
      for (const [name, config] of Object.entries(BUILTIN_MCPS)) {
        editor.set(name, config)
      }
    })
    console.log("[omo-v2-bridge] MCP servers registered:", Object.keys(BUILTIN_MCPS).join(", "))
  } catch (e) {
    console.error("[omo-v2-bridge] MCP registration error:", e instanceof Error ? e.message : String(e))
  }

  // V2 agent registration: register OMC agents and set sisyphus as default
  const OMC_AGENTS = [
    { id: "sisyphus", name: "Sisyphus", description: "Powerful AI orchestrator with parallel execution", mode: "primary", system: "You are Sisyphus, a powerful AI orchestrator.", color: "#00CED1" },
    { id: "oracle", name: "Oracle", description: "Strategic technical advisor", mode: "subagent", system: "You are Oracle, a strategic technical advisor." },
    { id: "librarian", name: "Librarian", description: "Documentation and code search specialist", mode: "subagent", system: "You are Librarian, a documentation search specialist." },
    { id: "explore", name: "Explore", description: "Codebase search specialist", mode: "subagent", system: "You are Explore, a codebase search specialist." },
    { id: "multimodal-looker", name: "Multimodal Looker", description: "Media file analysis agent", mode: "subagent", system: "You are Multimodal Looker, a media analysis agent." },
    { id: "prometheus", name: "Prometheus", description: "Planning specialist", mode: "subagent", system: "You are Prometheus, a planning specialist." },
    { id: "metis", name: "Metis", description: "Pre-planning consultant", mode: "subagent", system: "You are Metis, a pre-planning consultant." },
    { id: "momus", name: "Momus", description: "Work plan reviewer", mode: "subagent", system: "You are Momus, a work plan reviewer." },
    { id: "atlas", name: "Atlas", description: "Task list orchestrator", mode: "primary", system: "You are Atlas, a task list orchestrator.", color: "#10B981" },
    { id: "hephaestus", name: "Hephaestus", description: "Autonomous deep worker", mode: "primary", system: "You are Hephaestus, an autonomous deep worker.", color: "#D97706" },
    { id: "sisyphus-junior", name: "Sisyphus-Junior", description: "Focused task executor", mode: "subagent", system: "You are Sisyphus-Junior, a focused task executor.", color: "#20B2AA" },
  ]

  try {
    await ctx.agent?.transform?.((editor: any) => {
      for (const def of OMC_AGENTS) {
        editor.update(def.id, (agent: any) => {
          agent.name = def.name
          agent.description = def.description
          agent.mode = def.mode
          agent.system = def.system
          agent.hidden = false
          if (def.color) agent.color = def.color
          return agent
        })
      }
      // Demote built-in build/plan agents to hidden subagents
      for (const builtinId of ["build", "plan"]) {
        if (editor.get(builtinId)) {
          editor.update(builtinId, (agent: any) => {
            agent.mode = "subagent"
            agent.hidden = true
            return agent
          })
        }
      }
      // Set sisyphus as the default agent
      editor.default("sisyphus")
    })
    console.log("[omo-v2-bridge] agents registered, sisyphus set as default")
  } catch (e) {
    console.error("[omo-v2-bridge] agent registration error:", e instanceof Error ? e.message : String(e))
  }
}

export default pluginModule

export type {
  AgentName,
  AgentOverrideConfig,
  AgentOverrides,
  BuiltinCommandName,
  HookName,
  McpName,
  OhMyOpenCodeConfig,
} from "./config"

export type { ConfigLoadError } from "./shared/config-errors"
