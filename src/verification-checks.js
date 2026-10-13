import {readConfig} from './files.js';
import {supplementWithBehavioralContracts} from './behavioral-contracts.js';
import {verifyTypecheck} from './typecheck.js';

/** Additional native oracles supplement runtime cases. They never narrow the
 * native selection, erase failed-case history or grant publication authority. */
export function supplementWithChecks(root,report,{openingInputs,requested}={}) {
 const config=readConfig(root),combined=supplementWithBehavioralContracts(root,report,{requestedRepair:requested?.repair}),settings=requested?.typescript||config.plugins?.typescript;
 if(settings?.enabled!==true)return combined;
 const typecheck=verifyTypecheck(root,{project:settings.project||'tsconfig.json',timeoutMs:settings.timeoutMs,
  expectedProvenance:report.provenance||report.plan?.provenance,openingInputs});
 return {...combined,nativeExitCode:combined.nativeExitCode??report.exitCode,nativeComplete:combined.nativeComplete??report.complete,typecheck,
  exitCode:typecheck.exitCode===2||combined.exitCode===2?2:typecheck.exitCode===1?1:combined.exitCode,
  ...(combined.timings?{timings:{...combined.timings,typecheckOpeningMs:openingInputs?.durationMs??0,typecheckMs:typecheck.durationMs,totalMs:combined.timings.totalMs+typecheck.durationMs}}:{})};
}
