/** Diagnostic wall-clock spans; never an evidence identity or freshness token. */
export function phaseTimings() {
  const start = performance.now();
  let previous = start;
  const phases = {};
  return {
    mark(name) {
      const now = performance.now();
      phases[name] = (phases[name] || 0) + now - previous;
      previous = now;
    },
    finish() { return { totalMs: performance.now() - start, phases }; }
  };
}
