// Public node:test reporter protocol. A private prefix prevents test console output
// from being interpreted as trusted runner events.
export default async function* reporter(source) {
  for await (const event of source) {
    const data = event.data || {};
    if (['test:enqueue', 'test:pass', 'test:fail', 'test:summary'].includes(event.type)) {
      yield '@tddswarm:' + JSON.stringify({ type: event.type, data: {
        name: data.name, file: data.file, line: data.line, column: data.column,
        nesting: data.nesting, testNumber: data.testNumber,
        skip: data.skip, todo: data.todo, details: data.details && {
          duration_ms: data.details.duration_ms, type: data.details.type,
          error: data.details.error && { message: data.details.error.message, failureType: data.details.error.failureType }
        }, success: data.success, counts: data.counts
      } }) + '\n';
    } else if (['test:stdout', 'test:stderr'].includes(event.type)) {
      yield '@tddswarm:' + JSON.stringify({type: event.type, data: {message: data.message || ''}}) + '\n';
    }
  }
}
