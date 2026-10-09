/** Consult live bindings for each request; equality is object identity plus SSR mode. */
export function createNativeResolutionPass(projectServers){
 const validate=servers=>{
  if(!Array.isArray(servers)||servers.length>129)throw Error('Unbounded native resolution project servers');
  return servers;
 };
 if(typeof projectServers!=='function')validate(projectServers);
 let requests=0,calls=0,pairs=0,uniquePairs=0,avoided=0,serverCount=null,serverObservations=0;
 return {
  async resolve(specifier,importer){
   if(typeof specifier!=='string'||typeof importer!=='string')throw Error('Invalid native resolution request');
   requests++;
   const servers=validate(typeof projectServers==='function'?projectServers():projectServers);
   serverCount=servers.length;serverObservations+=servers.length;
   const results=[],seen=new Map();
   // Read project/server bindings anew, including after earlier awaited calls.
   // There is no target or result cache shared by separate requests.
   for(const server of servers)for(const ssr of [false,true]){
    pairs++;
    const container=ssr&&server?.environments?.ssr?.pluginContainer||server?.pluginContainer;
    if(!container||!['object','function'].includes(typeof container)||typeof container.resolveId!=='function')throw Error('Missing native resolution container');
    const modes=seen.get(container)||new Set();seen.set(container,modes);
    if(modes.has(ssr)){avoided++;continue;}
    modes.add(ssr);uniquePairs++;calls++;
    results.push(await container.resolveId(specifier,importer,{ssr}));
   }
   return results;
  },
  // Pair/call counters are aggregates of work actually reached, even on error.
  diagnostics(){return {schemaVersion:2,policy:'same-live-container-object-and-ssr-per-request',projectServers:serverCount,projectServerObservations:serverObservations,requestedPairs:pairs,uniquePairs,requestCount:requests,callCount:calls,avoidedPairCalls:avoided,crossRequestCache:false};}
 };
}
