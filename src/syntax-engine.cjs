const {inspectEngine,assertEngineUnchanged,files}=require('./syntax-engine-identity.cjs');
// A cached compiler of unknown provenance cannot be retroactively attested.
const optimizationAvailable=!(require.cache[files.parserSha256]||require.cache[files.typescriptImplementationSha256]);
const binding=inspectEngine();
const parser=require('./source-analysis.cjs');
assertEngineUnchanged(binding);
const after=inspectEngine();
if(JSON.stringify(binding.identity)!==JSON.stringify(after.identity))throw new Error('Canonical syntax engine changed during loading');
function assertCurrentEngine(){if(optimizationAvailable)assertEngineUnchanged(binding);}
exports.analyze=(...args)=>{assertCurrentEngine();const result=parser.analyze(...args);assertCurrentEngine();return result;};
exports.configurationFlags=(...args)=>{assertCurrentEngine();const result=parser.configurationFlags(...args);assertCurrentEngine();return result;};
exports.typescript=parser.typescript;
exports.typescriptVersion=parser.typescriptVersion;
exports.loadedIdentity=optimizationAvailable?Object.freeze({...binding.identity}):null;
exports.optimizationAvailable=optimizationAvailable;
exports.assertCurrentEngine=assertCurrentEngine;
