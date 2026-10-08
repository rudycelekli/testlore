import path from 'node:path';

// Internal, fresh resolver observations. Public mapping declarations cannot
// supply this contract or relax unsupported project/case identity boundaries.
export function normalizeNativeProjects(root, projects, files, local) {
 if(projects===undefined)return [];
 if(!Array.isArray(projects)||projects.length>128)throw new Error('Unbounded native project inventory');
 if(!projects.length&&files.length)throw new Error('Incomplete native project membership');
 const known=new Set(files),members=new Set(),names=new Set();let setupEdges=0;
 return projects.map(project=>{
  if(typeof project?.name!=='string'||project.name.length>200||names.has(project.name)||typeof project.isolate!=='boolean'||!Array.isArray(project.files)||project.files.length>10000||project.files.some(file=>typeof file!=='string')||!Array.isArray(project.setupFiles)||project.setupFiles.length>1000||project.setupFiles.some(file=>typeof file!=='string'))throw new Error('Invalid native project contract');
  names.add(project.name);
  const normalized=project.files.map(file=>local(root,path.resolve(root,file)));
  setupEdges+=normalized.length*new Set(project.setupFiles).size;
  if(setupEdges>50000)throw new Error('Native project setup edges exceed the graph budget');
  for(const file of normalized){if(!known.has(file)||members.has(file))throw new Error('Overlapping or unknown native project file membership');members.add(file);}
  return {name:project.name,isolate:project.isolate,files:normalized.sort(),setupFiles:[...new Set(project.setupFiles.map(file=>local(root,path.resolve(root,file))))].sort()};
 }).map((project,index,all)=>{
  if(index===all.length-1&&members.size!==known.size)throw new Error('Incomplete native project membership');
  return project;
 });
}
