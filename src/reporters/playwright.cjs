const fs = require('node:fs');

// Uses Playwright's public Reporter/TestCase/Suite APIs. This is trusted project
// execution, not a security boundary. A missing terminal seal is incomplete.
module.exports = class TestLorePlaywrightReporter {
  constructor() { this.report = {schemaVersion:1, adapter:'playwright', began:false, ended:false, exited:false, inventory:[], tests:[], errors:[]}; }
  printsToStdio() { return true; }
  entry(test) {
    const project = test.parent.project();
    return {nativeId:test.id, file:test.location.file, title:test.title,
      titles:test.titlePath().slice(3), project:project?.name || '', repeatEachIndex:test.repeatEachIndex,
      line:test.location.line, column:test.location.column, expectedStatus:test.expectedStatus};
  }
  onBegin(config, suite) {
    this.suite = suite; this.report.began = true;
    this.report.inventory = suite.allTests().map(test=>this.entry(test));
    this.report.projects = config.projects.map(project=>({name:project.name, dependencies:project.dependencies, teardown:project.teardown, testDir:project.testDir}));
    // Scope filters cannot masquerade as full-suite discovery. --project is an
    // explicitly configured project scope; all its dependency projects remain.
    const grep = value=>Array.isArray(value)?value.some(grep):value && value.source !== '.*';
    if(config.shard || config.projects.some(project=>grep(project.grep)||project.grepInvert)) this.report.errors.push('Filtered or sharded Playwright configuration cannot certify complete native scope');
  }
  onError(error) { this.report.errors.push(error.message || error.stack || String(error)); }
  onStdOut(chunk) { process.stdout.write(chunk); }
  onStdErr(chunk) { process.stderr.write(chunk); }
  onEnd(result) {
    this.report.ended = true; this.report.nativeStatus = result.status;
    this.report.tests = (this.suite?.allTests() || []).map(test=>({...this.entry(test), outcome:test.outcome(),
      attempts:test.results.map(attempt=>({status:attempt.status, retry:attempt.retry, durationMs:attempt.duration,
        errors:attempt.errors.map(error=>({message:error.message, value:error.value}))}))}));
  }
  onExit() {
    this.report.exited = true;
    if(process.env.TESTLORE_PLAYWRIGHT_REPORT) fs.writeFileSync(process.env.TESTLORE_PLAYWRIGHT_REPORT,JSON.stringify(this.report));
  }
};
