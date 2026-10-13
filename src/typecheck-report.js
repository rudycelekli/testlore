const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const canonical=value=>typeof value==='string'&&value.length>0&&value.length<=1024&&!value.includes('\\')&&!/[\x00-\x1f\x7f]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const paths=value=>Array.isArray(value)&&value.length<=10000&&new Set(value).size===value.length&&value.every(canonical);
/** Display admission only. Retained JSON cannot mint native execution authority. */
export function summarizeTypecheck(input,{expectedProvenance}={}) {
 const requested=input!==undefined,check=object(input)?input:{};
 const diagnostics=Array.isArray(check.diagnostics)?check.diagnostics:[];
 const diagnosticValid=row=>object(row)&&Number.isSafeInteger(row.code)&&row.code>0&&['error','warning','message','suggestion'].includes(row.category)&&
  (row.file===null||canonical(row.file))&&(row.line===null||Number.isSafeInteger(row.line)&&row.line>0)&&(row.column===null||Number.isSafeInteger(row.column)&&row.column>0)&&typeof row.message==='string'&&row.message.length<=4096;
 const sharedWindow=expectedProvenance===undefined||(object(expectedProvenance)&&sha(expectedProvenance.fingerprint)&&check.binding?.provenance?.fingerprint===expectedProvenance.fingerprint&&check.binding?.provenance?.revision===expectedProvenance.revision);
 const shape=sharedWindow&&check.schemaVersion===1&&check.kind==='native-typecheck'&&check.complete===true&&check.signal===null&&check.errorCode===null&&
  paths(check.files)&&check.files.length>0&&paths(check.implementationFiles)&&JSON.stringify(check.files)===JSON.stringify(check.implementationFiles)&&
  paths(check.programFiles)&&check.files.every(file=>check.programFiles.includes(file))&&
  Array.isArray(check.diagnostics)&&diagnostics.length<=10000&&diagnostics.every(diagnosticValid)&&new Set(diagnostics.map(row=>JSON.stringify(row))).size===diagnostics.length&&
  typeof check.compiler?.version==='string'&&/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(check.compiler.version)&&sha(check.compiler.sha256)&&sha(check.compiler.manifestSha256)&&
  sha(check.binding?.source?.sha256)&&sha(check.binding?.dependencies?.sha256)&&sha(check.binding?.provenance?.fingerprint)&&sha(check.binding?.node?.sha256)&&sha(check.binding?.projectSha256)&&
  Array.isArray(check.reasons)&&check.reasons.length===0&&Number.isFinite(check.durationMs)&&check.durationMs>=0&&
  Array.isArray(check.suppressions)&&check.suppressions.length<=10000&&check.suppressions.every(row=>object(row)&&canonical(row.file)&&['ts-ignore','ts-expect-error'].includes(row.directive)&&Number.isSafeInteger(row.line)&&row.line>0&&Number.isSafeInteger(row.column)&&row.column>0);
 const errors=diagnostics.filter(row=>row?.category==='error');
 const passed=shape&&check.status==='passed'&&check.exitCode===0&&errors.length===0;
 const failed=shape&&check.status==='failed'&&check.exitCode===1&&errors.length>0;
 return {requested,status:!requested?'not-configured':passed?'passed':failed?'failed':'incomplete',complete:passed||failed,
  implementationCount:paths(check.implementationFiles)?check.implementationFiles.length:null,
  programFileCount:paths(check.programFiles)?check.programFiles.length:null,errorCount:errors.length,
  diagnostics:errors.filter(diagnosticValid).slice(0,10).map(({code,file,line,column})=>({code,file,line,column})),
  suppressionCount:Array.isArray(check.suppressions)?check.suppressions.length:null,
  compilerVersion:typeof check.compiler?.version==='string'?check.compiler.version.slice(0,80):null,
  limitations:Array.isArray(check.limitations)?check.limitations.filter(item=>typeof item==='string').slice(0,10).map(item=>item.slice(0,512)):[],
  scope:'Declared TypeScript implementation scope only; excluded files, suppression directives and owner library-check settings remain coverage gaps.'};
}
