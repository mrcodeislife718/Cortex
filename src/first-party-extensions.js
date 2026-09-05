export const FirstPartyExtensions = Object.freeze([
  extension('cortex.scout', 'Scout Language & Config', 'Structured data, schema, diagnostics, formatting, recovery parsing, and editor intelligence for Scout.', 'language', ['onLanguage:scout'], ['language.read'], {
    commands: [
      { id:'scout.formatDocument', title:'Scout: Format Document', category:'Scout' },
      { id:'scout.validateDocument', title:'Scout: Validate Document', category:'Scout' }
    ],
    languages: [{ id:'scout', extensions:['.scout','.scout-d'], aliases:['Scout'] }],
    views: [{ id:'scout.schema', title:'Scout Schema' }]
  }),
  extension('cortex.cannon', 'Cannon Language', 'Cannon language support, compiler diagnostics, navigation, execution, and toolchain integration.', 'language', ['onLanguage:cannon'], ['language.read','process.execute'], {
    commands: [
      { id:'cannon.runFile', title:'Cannon: Run Current File', category:'Cannon' },
      { id:'cannon.buildFile', title:'Cannon: Build Current File', category:'Cannon' },
      { id:'cannon.showIr', title:'Cannon: Show Nova IR', category:'Cannon' }
    ],
    languages: [{ id:'cannon', extensions:['.cannon'], aliases:['Cannon'] }],
    views: [{ id:'cannon.toolchain', title:'Cannon Toolchain' }]
  }),
  extension('cortex.cannon-plus', 'Cannon+ Systems', 'Strict typing, ownership, regions, pointers, ABI, and safety-profile tooling for Cannon+.', 'language', ['onLanguage:cannon+'], ['language.read'], {
    commands: [
      { id:'cannonPlus.check', title:'Cannon+: Check Current File', category:'Cannon+' },
      { id:'cannonPlus.memoryModel', title:'Cannon+: Inspect Memory Model', category:'Cannon+' }
    ],
    languages: [{ id:'cannon+', extensions:['.cannon+'], aliases:['Cannon+'] }],
    views: [{ id:'cannonPlus.memory', title:'Cannon+ Memory' }]
  }),
  extension('cortex.nova', 'Nova Intelligence', 'Authoritative semantic graph, diagnostics, IR, provenance, and compiler-intelligence views.', 'workspace', ['onWorkspace'], ['workspace.read'], {
    commands: [
      { id:'nova.showSemanticGraph', title:'Nova: Show Semantic Graph', category:'Nova' },
      { id:'nova.explainDiagnostic', title:'Nova: Explain Diagnostic', category:'Nova' }
    ],
    views: [{ id:'nova.semanticGraph', title:'Semantic Graph' }, { id:'nova.diagnostics', title:'Nova Diagnostics' }]
  }),
  extension('cortex.parallel', 'Parallel Runtime', 'Runtime execution, permissions, tasks, workers, networking, and native runtime inspection.', 'tool', ['onWorkspace'], ['process.execute'], {
    commands: [
      { id:'parallel.run', title:'Parallel: Run Application', category:'Parallel' },
      { id:'parallel.showCapabilities', title:'Parallel: Show Runtime Capabilities', category:'Parallel' }
    ],
    views: [{ id:'parallel.runtime', title:'Parallel Runtime' }]
  }),
  extension('cortex.plasma', 'Plasma Interop', 'Interop/FFI boundary inspection, generated bindings, adapter health, and ownership diagnostics.', 'tool', ['onWorkspace'], ['workspace.read'], {
    commands: [
      { id:'plasma.generateBinding', title:'Plasma: Generate Binding', category:'Plasma' },
      { id:'plasma.inspectBoundary', title:'Plasma: Inspect Boundary', category:'Plasma' }
    ],
    views: [{ id:'plasma.boundaries', title:'Plasma Boundaries' }]
  }),
  extension('cortex.cadence', 'Cadence Backend', 'Cadence routes, middleware, validation, sessions, WebSockets, RPC, OpenAPI, and server tooling.', 'workspace', ['onWorkspace'], ['workspace.read','process.execute'], {
    commands: [
      { id:'cadence.runServer', title:'Cadence: Run Server', category:'Cadence' },
      { id:'cadence.showRoutes', title:'Cadence: Show Routes', category:'Cadence' },
      { id:'cadence.openApi', title:'Cadence: Generate OpenAPI', category:'Cadence' }
    ],
    views: [{ id:'cadence.routes', title:'Cadence Routes' }]
  }),
  extension('cortex.sprout', 'Sprout UI', 'Sprout component, reactivity, SSR/hydration, accessibility, and browser tooling.', 'workspace', ['onWorkspace'], ['workspace.read','process.execute'], {
    commands: [
      { id:'sprout.preview', title:'Sprout: Open Preview', category:'Sprout' },
      { id:'sprout.inspectReactivity', title:'Sprout: Inspect Reactivity', category:'Sprout' }
    ],
    views: [{ id:'sprout.components', title:'Sprout Components' }]
  }),
  extension('cortex.velocity', 'Velocity Apps', 'Project/workspace graph, dev workflow, targets, previews, builds, and universal-app tooling.', 'workspace', ['onWorkspace'], ['workspace.read','process.execute'], {
    commands: [
      { id:'velocity.dev', title:'Velocity: Start Dev Session', category:'Velocity' },
      { id:'velocity.build', title:'Velocity: Build Target', category:'Velocity' },
      { id:'velocity.showGraph', title:'Velocity: Show Project Graph', category:'Velocity' }
    ],
    views: [{ id:'velocity.targets', title:'Velocity Targets' }]
  }),
  extension('cortex.chronos', 'Chronos Deployments', 'Remote builds, artifacts, previews, releases, staged rollout, rollback, and deployment evidence.', 'workspace', ['onWorkspace'], ['workspace.read','network.request'], {
    commands: [
      { id:'chronos.build', title:'Chronos: Remote Build', category:'Chronos' },
      { id:'chronos.deploy', title:'Chronos: Deploy Release', category:'Chronos' },
      { id:'chronos.rollback', title:'Chronos: Roll Back Release', category:'Chronos' }
    ],
    views: [{ id:'chronos.deployments', title:'Chronos Deployments' }, { id:'chronos.artifacts', title:'Chronos Artifacts' }]
  })
]);

export function installFirstPartyExtensions(platform) {
  const installed = new Set(platform.list().map((entry) => entry.manifest.id));
  return FirstPartyExtensions.map((manifest) => installed.has(manifest.id) ? platform.describe(manifest.id) : platform.install(manifest));
}

function extension(id, name, description, runtime, activationEvents, capabilities, contributions) {
  return Object.freeze({
    id,
    name,
    displayName:name,
    description,
    publisher:'Cortex',
    firstParty:true,
    version:'1.0.0',
    runtime,
    activationEvents,
    capabilities,
    executionLevel:'OBSERVE',
    budgets:{ activationMs:1500 },
    compatibility:{ vscode:false, apiVersion:'1' },
    contributions
  });
}
