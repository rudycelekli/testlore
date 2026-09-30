import ts from 'typescript';
import { buildGraph, analyze, dependencies } from './graph.js';
import { TEST } from './files.js';

export function inspectTest(file, text) {
  const { ast } = analyze(file, text);
  const metrics = { cases: 0, assertions: 0, snapshots: 0, skipped: 0, exclusive: 0, fixedSleeps: 0, emptyCases: 0 };
  const findings = [];
  const line = node => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
  const assertion = node => ts.isCallExpression(node) && (/^assert(?:\.[\w]+)?$/.test(node.expression.getText(ast)) || /^expect\([\s\S]+\)(?:\.(?:not|resolves|rejects))*\.\w+$/.test(node.expression.getText(ast)) || /^.*\.should\./.test(node.expression.getText(ast)));
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(ast);
      if (/^(?:test|it|describe)(?:\.(?:skip|todo|only|each|concurrent))*$/.test(name)) {
        if (/\.(skip|todo)\b/.test(name)) { metrics.skipped++; findings.push({ line: line(node), code: 'skipped-test', message: 'Document why this test is disabled and set an owner.' }); }
        if (/\.only\b/.test(name)) { metrics.exclusive++; findings.push({ line: line(node), code: 'exclusive-test', message: 'Remove .only; it can hide the rest of the suite.' }); }
        if (!name.startsWith('describe')) {
          metrics.cases++;
          const body = node.arguments.find(a => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
          if (body) {
            let hasAssertion = false;
            function scan(n) { if (assertion(n)) hasAssertion = true; ts.forEachChild(n, scan); }
            scan(body);
            if (!hasAssertion) { metrics.emptyCases++; findings.push({ line: line(node), code: 'no-visible-assertion', message: 'No recognized assertion in this body. Verify custom helpers before adding an independent behavior assertion.' }); }
          }
        }
      }
      // Count matcher calls, not the nested expect(...) subject constructor.
      if (/^assert(?:\.[\w]+)?$/.test(name) || /^expect\([\s\S]+\)(?:\.(?:not|resolves|rejects))*\.\w+$/.test(name)) metrics.assertions++;
      if (/\.(?:toMatchSnapshot|toMatchInlineSnapshot|toMatchImageSnapshot)$/.test(name)) metrics.snapshots++;
      if (/(?:^|\.)(?:setTimeout|waitForTimeout|sleep)$/.test(name)) {
        if (node.arguments.some(a => ts.isNumericLiteral(a))) { metrics.fixedSleeps++; findings.push({ line: line(node), code: 'fixed-sleep', message: 'Prefer waiting for a condition or a controlled clock.' }); }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!metrics.cases) findings.push({ line: 1, code: 'unrecognized-tests', message: 'No conventional test/it calls recognized. Static scoring cannot judge custom DSLs.' });
  if (metrics.assertions > 0 && metrics.assertions === metrics.snapshots) findings.push({ line: 1, code: 'snapshot-only', message: 'Add behavior assertions alongside snapshots.' });
  return { file, metrics, findings };
}

export function audit(root) {
  const graph = buildGraph(root);
  const files = graph.tests.map(file => inspectTest(file, graph.sources[file]));
  const count = files.length;
  const totals = files.reduce((sum, f) => { for (const [k, v] of Object.entries(f.metrics)) sum[k] = (sum[k] || 0) + v; return sum; }, {});
  const sources = Object.keys(graph.sources).filter(f => !TEST.test(f));
  const linked = new Set(graph.tests.flatMap(t => dependencies(graph, t)));
  const uncovered = sources.filter(f => !linked.has(f));
  const dimensions = count ? {
    visibleAssertions: Math.round(35 * files.filter(f => f.metrics.assertions > 0 && f.metrics.emptyCases === 0).length / count),
    enabledSuite: Math.max(0, 25 - 5 * (totals.skipped + totals.exclusive)),
    waits: Math.max(0, 15 - 3 * totals.fixedSleeps),
    behaviorSignals: Math.round(15 * files.filter(f => f.metrics.assertions > f.metrics.snapshots).length / count),
    dependencyVisibility: graph.warnings.length ? 0 : 10
  } : null;
  const score = dimensions ? Object.values(dimensions).reduce((a, b) => a + b, 0) : null;
  return {
    schemaVersion: 1, grade: score === null ? 'ungraded' : score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F',
    score, label: 'Static triage grade — not a test-effectiveness score', dimensions,
    testFiles: count, sourceFiles: sources.length, totals, files, sourcesWithoutImportingTests: uncovered,
    warnings: graph.warnings,
    measured: { execution: false, coverage: false, mutation: false, flakiness: false, speed: false },
    suggestions: count ? ['Review findings with custom assertion helpers in mind.', 'Measure coverage and mutation results before judging effectiveness.', 'Use modules to review broad dependency boundaries.'] : ['No tests detected. Run generate to prepare an agent work order.', 'Add requirements and independent expected behaviors before generating tests.']
  };
}

export function modules(root) {
  const graph = buildGraph(root);
  const groups = new Map();
  for (const test of graph.tests) {
    const deps = dependencies(graph, test).filter(f => !TEST.test(f));
    const subject = deps.find(f => /(?:^|\/)(src|lib|app)\//.test(f)) || deps[0];
    const group = subject ? subject.split('/').slice(0, -1).join('/') || '.' : 'unmapped';
    if (!groups.has(group)) groups.set(group, { name: group, tests: [], dependencies: new Set() });
    const entry = groups.get(group); entry.tests.push(test); deps.forEach(d => entry.dependencies.add(d));
  }
  return {
    schemaVersion: 1, kind: 'modularization-proposal',
    groups: [...groups.values()].map(g => ({ ...g, dependencies: [...g.dependencies].sort() })),
    broadTests: graph.tests.map(test => ({ test, dependencyCount: dependencies(graph, test).length })).filter(t => t.dependencyCount > 10),
    recommendations: ['Group tests by subject ownership; preserve shared contracts and end-to-end checks.', 'Split broad files only after comparing original and refactored test behavior.', 'Declare asset and runtime dependencies in tddswarm.config.json.'],
    rewritten: false
  };
}
