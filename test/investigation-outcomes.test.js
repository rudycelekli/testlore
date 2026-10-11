import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { qualifyBugRecipe, captureBugProbeSource } from '../src/bug-recipes.js';
import { investigateBugs } from '../src/bug-investigation.js';
import { recordInvestigationOutcome, inspectInvestigationLearning, prioritizeBugRecipes, investigationDependencyLinks } from '../src/investigation-outcomes.js';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const source = 'export function encode(value){return value.length;}\n';
const fixed = 'export function encode(value){return Array.from(value).length;}\n';
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testlore-outcomes-'));
  t.after(() => fs.rmSync(root, {recursive:true,force:true}));
  const before = path.join(root, 'before'), after = path.join(root, 'after');
  fs.mkdirSync(before); fs.mkdirSync(after);
  fs.writeFileSync(path.join(before, 'subject.mjs'), source); fs.writeFileSync(path.join(after, 'subject.mjs'), fixed);
  fs.writeFileSync(path.join(root, 'subject.mjs'), source); fs.writeFileSync(path.join(root, 'native.test.mjs'), '// Preserved independent native test declaration\n');
  fs.writeFileSync(path.join(root, 'contract.md'), 'encode returns the number of Unicode code points.\n');
  const recipe = {schemaVersion:1,kind:'bug-recipe',id:'unicode-count',family:'unicode-boundary',provenance:{repository:'https://github.com/example/constructed',baseRevision:'a'.repeat(40),fixedRevision:'b'.repeat(40),evidenceClass:'constructed'},contract:{text:'Return the number of Unicode code points.',sourceUrl:'https://example.test/specification',sourceSha256:hash('independent specification'),independence:'independent-specification'},probe:{exportName:'encode',cases:[{id:'astral',args:['😀'],expect:{kind:'equals',value:1}}]},applicability:{requiredIdentifiers:['encode']}};
  fs.writeFileSync(path.join(root, 'recipe.json'), JSON.stringify(recipe));
  await qualifyBugRecipe({recipe,original:{root:before,module:'subject.mjs',files:['subject.mjs']},fixed:{root:after,module:'subject.mjs',files:['subject.mjs']},outputRoot:path.join(root,'qualification')});
  const recipeSha256 = hash(fs.readFileSync(path.join(root, 'recipe.json')));
  const manifest = {schemaVersion:1,kind:'bug-investigation-manifest',recipes:[{path:'recipe.json',sha256:recipeSha256,qualification:{path:'qualification/qualification.json',sha256:hash(fs.readFileSync(path.join(root,'qualification/qualification.json')))}}],targets:[{id:'unicode',module:'subject.mjs',files:['subject.mjs'],tests:['native.test.mjs'],contracts:[{recipeId:recipe.id,recipeSha256,sourceSha256:captureBugProbeSource(root,{module:'subject.mjs',files:['subject.mjs']}).sourceSha256,expectation:{path:'contract.md',sha256:hash(fs.readFileSync(path.join(root,'contract.md')))},reviewer:'independent-test-reviewer'}]}],budget:{totalMs:10000,timeoutMs:1000,maxInvestigations:3}};
  fs.writeFileSync(path.join(root,'tddswarm.probes.json'),JSON.stringify(manifest));
  const executed = await investigateBugs(root,{execute:true});
  const reportSha256 = hash(fs.readFileSync(path.join(root,executed.receipt)));
  assert.equal(executed.findings[0].outcome,'reproduced');
  return {root,recipe,recipeSha256,executed,request:{report:executed.receipt,reportSha256,findingId:executed.findings[0].id,verdict:'useful',reviewer:'maintainer'}};
}

test('actual repeated probe observation and human disposition remain separate, local and hash-bound', async t => {
  const f = await fixture(t), recorded = recordInvestigationOutcome(f.root,{...f.request,note:'Confirmed independently',cost:{usd:0.03}});
  assert.equal(recorded.recorded,true,recorded.reason);
  const receipt = JSON.parse(fs.readFileSync(path.join(f.root,recorded.file),'utf8'));
  assert.equal(receipt.observation.outcome,'reproduced'); assert.equal(receipt.disposition.verdict,'useful');
  assert.equal(receipt.disposition.cost.provenance,'reviewer-supplied-unverified'); assert.equal(receipt.authority,'none');
  assert.equal(fs.statSync(path.join(f.root,recorded.file)).mode & 0o777,0o600);
  const summary = inspectInvestigationLearning(f.root);
  assert.equal(summary.observations,1); assert.equal(summary.usableObservations,1); assert.equal(summary.counts.useful,1);
  assert.equal(summary.causalImprovement,'unproven'); assert.ok(!JSON.stringify(summary).includes('Confirmed independently'));
});

test('same observation cannot be relabeled or counted twice even with a copied report identity', async t => {
  const f = await fixture(t), first = recordInvestigationOutcome(f.root,f.request);
  assert.equal(first.recorded,true);
  assert.equal(recordInvestigationOutcome(f.root,{...f.request,verdict:'false-positive',reviewer:'other'}).reason,'investigation-outcome-already-recorded');
  const original = fs.readFileSync(path.join(f.root,first.file));
  const value = JSON.parse(fs.readFileSync(path.join(f.root,f.request.report)));
  delete value.integrity; value.id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; value.integrity = hash(value);
  fs.writeFileSync(path.join(f.root,'copied-report.json'),JSON.stringify(value));
  const copied = recordInvestigationOutcome(f.root,{...f.request,report:'copied-report.json',reportSha256:hash(fs.readFileSync(path.join(f.root,'copied-report.json')))});
  assert.equal(copied.recorded,false);
  assert.deepEqual(fs.readFileSync(path.join(f.root,first.file)),original); assert.equal(inspectInvestigationLearning(f.root).observations,1);
});

test('historical usefulness survives source changes without claiming current correctness or routing authority', async t => {
  const f = await fixture(t); fs.writeFileSync(path.join(f.root,'subject.mjs'),fixed);
  const recorded = recordInvestigationOutcome(f.root,f.request); assert.equal(recorded.recorded,true,recorded.reason);
  const receipt = JSON.parse(fs.readFileSync(path.join(f.root,recorded.file))); assert.equal(receipt.sourceStatusAtReview,'stale');
  const summary = inspectInvestigationLearning(f.root); assert.equal(summary.historicalStaleObservations,1); assert.equal(summary.usableObservations,1); assert.equal(summary.currentCorrectness,'not-established');
  const ranked = prioritizeBugRecipes(f.root,[{id:f.recipe.id,sha256:f.recipeSha256,family:f.recipe.family}],{remainingMs:5000});
  assert.equal(ranked.selected[0].observations,1); assert.equal(ranked.authority,'none');
  const links = investigationDependencyLinks(f.root,f.request.report,{expectedSha256:f.request.reportSha256});
  assert.equal(links.stale,true); assert.equal(links.omissionsPermitted,false); assert.equal(links.proposals[0].status,'stale-source-binding');
});

test('proposed links name only declared associated tests and never authorize omissions', async t => {
  const f = await fixture(t), links = investigationDependencyLinks(f.root,f.request.report,{expectedSha256:f.request.reportSha256});
  assert.equal(links.stale,false); assert.deepEqual(links.proposals[0].associatedTests,['native.test.mjs']);
  assert.equal(links.proposals[0].source,'subject.mjs'); assert.equal(links.proposals[0].routingAuthority,'none'); assert.equal(links.omissionsPermitted,false);
  links.proposals[0].associatedTests.push('invented.test.mjs');
  assert.deepEqual(investigationDependencyLinks(f.root,f.request.report,{expectedSha256:f.request.reportSha256}).proposals[0].associatedTests,['native.test.mjs']);
  assert.deepEqual(fs.readFileSync(path.join(f.root,'native.test.mjs'),'utf8'),'// Preserved independent native test declaration\n');
});

test('actual passing probe cannot be reported as a useful defect', async t => {
  const f = await fixture(t); fs.writeFileSync(path.join(f.root,'subject.mjs'),fixed);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root,'tddswarm.probes.json')));
  manifest.targets[0].contracts[0].sourceSha256 = captureBugProbeSource(f.root,{module:'subject.mjs',files:['subject.mjs']}).sourceSha256;
  fs.writeFileSync(path.join(f.root,'tddswarm.probes.json'),JSON.stringify(manifest));
  const report = await investigateBugs(f.root,{execute:true}); assert.equal(report.findings[0].outcome,'passed');
  const result = recordInvestigationOutcome(f.root,{...f.request,report:report.receipt,reportSha256:hash(fs.readFileSync(path.join(f.root,report.receipt))),findingId:report.findings[0].id});
  assert.equal(result.reason,'useful-verdict-requires-reproduced-observation');
});

test('bounded priority exposes uncertainty, time and unverified cost instead of an improvement guarantee', async t => {
  const f = await fixture(t); assert.equal(recordInvestigationOutcome(f.root,{...f.request,cost:{usd:2}}).recorded,true);
  const list = [{id:f.recipe.id,sha256:f.recipeSha256,family:f.recipe.family},{id:'cold-start',sha256:'f'.repeat(64),family:'filesystem-boundary'}];
  const result = prioritizeBugRecipes(f.root,list,{remainingMs:5000,maxInvestigations:2});
  assert.equal(result.selected.length,2); assert.ok(result.selected.reduce((sum,item)=>sum+item.estimateMs,0)<=5000);
  assert.ok(result.selected.some(item=>item.evidence==='cold-start-exploration')); assert.ok(result.selected.some(item=>item.costPenalty===3));
  assert.equal(result.executionBudgetEnforced,false); assert.equal(result.causalImprovement,'unproven');
  assert.equal(prioritizeBugRecipes(f.root,list,{remainingMs:0}).selected.length,0);
  assert.equal(prioritizeBugRecipes(f.root,list,{remainingMs:5000,maxInvestigations:0}).selected.length,0);
  assert.equal(prioritizeBugRecipes(f.root,[...list,list[0]],{remainingMs:5000}).reason,'invalid-investigation-priority-request');
  assert.equal(prioritizeBugRecipes(f.root,[{...list[0],run:'arbitrary'}],{remainingMs:5000}).reason,'invalid-investigation-priority-request');
});

test('real deadline failures stay inconclusive and increase observed timeout accounting', async t => {
  const f = await fixture(t); fs.writeFileSync(path.join(f.root,'subject.mjs'),'export function encode(value){while(true){}}\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root,'tddswarm.probes.json')));
  manifest.targets[0].contracts[0].sourceSha256 = captureBugProbeSource(f.root,{module:'subject.mjs',files:['subject.mjs']}).sourceSha256;
  manifest.budget.timeoutMs = 50;
  fs.writeFileSync(path.join(f.root,'tddswarm.probes.json'),JSON.stringify(manifest));
  const report = await investigateBugs(f.root,{execute:true});
  assert.equal(report.findings[0].outcome,'inconclusive'); assert.equal(report.findings[0].reason,'probe-timeout');
  const result = recordInvestigationOutcome(f.root,{...f.request,report:report.receipt,reportSha256:hash(fs.readFileSync(path.join(f.root,report.receipt))),findingId:report.findings[0].id,verdict:'inconclusive'});
  assert.equal(result.recorded,true,result.reason);
  const summary = inspectInvestigationLearning(f.root); assert.equal(summary.recipes[0].timeouts,1); assert.equal(summary.counts.useful,0);
});

test('negative maintainer dispositions reduce estimated yield but never globally suppress a recipe', async t => {
  const f = await fixture(t); assert.equal(recordInvestigationOutcome(f.root,{...f.request,verdict:'intentional-behavior'}).recorded,true);
  const metadata = [{id:f.recipe.id,sha256:f.recipeSha256,family:f.recipe.family}];
  const result = prioritizeBugRecipes(f.root,metadata,{remainingMs:5000,maxInvestigations:1});
  assert.equal(result.selected.length,1); assert.equal(result.selected[0].penalties,1); assert.equal(result.selected[0].yieldEstimate,1/3);
  assert.equal(result.selected[0].useful,0); assert.equal(result.authority,'none');
});

test('receipt corruption is quarantined, not silently converted into knowledge', async t => {
  const f = await fixture(t), result = recordInvestigationOutcome(f.root,f.request); assert.equal(result.recorded,true);
  const file = path.join(f.root,result.file), receipt = JSON.parse(fs.readFileSync(file)); receipt.disposition.verdict='false-positive'; fs.writeFileSync(file,JSON.stringify(receipt));
  assert.equal(inspectInvestigationLearning(f.root).reason,'invalid-investigation-outcome-store');
  assert.equal(prioritizeBugRecipes(f.root,[{id:f.recipe.id,sha256:f.recipeSha256,family:f.recipe.family}],{remainingMs:5000}).reason,'invalid-investigation-outcome-store');
  assert.equal(recordInvestigationOutcome(f.root,f.request).recorded,false);
});

test('missing or mutated reports quarantine dispositions without deleting original receipts', async t => {
  const f = await fixture(t), result = recordInvestigationOutcome(f.root,f.request); assert.equal(result.recorded,true);
  fs.appendFileSync(path.join(f.root,f.request.report),' ');
  const summary = inspectInvestigationLearning(f.root);
  assert.equal(summary.observations,1); assert.equal(summary.usableObservations,0); assert.equal(summary.reasons['report-unavailable-or-invalid'],1);
  assert.ok(fs.existsSync(path.join(f.root,result.file)));
});

test('unsafe report paths, missing expected hashes and invalid requests are refused', async t => {
  const f = await fixture(t);
  for (const request of [{...f.request,report:'../escape.json'},{...f.request,report:'/tmp/escape.json'},{...f.request,reportSha256:undefined},{...f.request,approval:true},{...f.request,cost:{usd:-1}},{...f.request,note:'x'.repeat(513)},{...f.request,reviewer:''}]) assert.equal(recordInvestigationOutcome(f.root,request).recorded,false);
  assert.equal(investigationDependencyLinks(f.root,f.request.report,{}).proposals.length,0);
  assert.equal(investigationDependencyLinks(f.root,f.request.report,{expectedSha256:'a'.repeat(64)}).proposals.length,0);
  fs.symlinkSync(path.join(f.root,f.request.report),path.join(f.root,'report-link.json'));
  assert.equal(recordInvestigationOutcome(f.root,{...f.request,report:'report-link.json'}).recorded,false);
});

test('unexpected store files, symlink stores and invalid UTF8 fail closed', async t => {
  const f = await fixture(t), result = recordInvestigationOutcome(f.root,f.request); assert.equal(result.recorded,true);
  fs.writeFileSync(path.join(f.root,'.tddswarm/investigations/outcomes/unexpected.txt'),'x');
  assert.equal(inspectInvestigationLearning(f.root).reason,'invalid-investigation-outcome-store');
  fs.unlinkSync(path.join(f.root,'.tddswarm/investigations/outcomes/unexpected.txt'));
  fs.writeFileSync(path.join(f.root,result.file),Buffer.from([0xc3,0x28]));
  assert.equal(inspectInvestigationLearning(f.root).reason,'invalid-investigation-outcome-store');
  const directory=path.join(f.root,'.tddswarm/investigations/outcomes'); fs.rmSync(directory,{recursive:true}); fs.symlinkSync(path.join(f.root,'qualification'),directory);
  assert.equal(inspectInvestigationLearning(f.root).reason,'invalid-investigation-outcome-store');
});

test('empty store invites bounded evidence collection and never presumes learning improvement', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'testlore-empty-outcomes-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const summary=inspectInvestigationLearning(root); assert.equal(summary.observations,0); assert.equal(summary.causalImprovement,'unproven'); assert.equal(summary.authority,'none');
  assert.equal(prioritizeBugRecipes(root,[],{remainingMs:5000}).selected.length,0);
});
