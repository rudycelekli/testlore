import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest } from './provenance.js';
import { safePath } from './files.js';

export function declaredInputs(config) {
  const mappings = {};
  function add(test, input) {
    if (typeof test !== 'string' || typeof input !== 'string' || !test || !input) throw new Error('Input declarations require test and input paths');
    (mappings[test] ||= []).push(input);
  }
  for (const [route, declaration] of Object.entries(config.browser?.routes || {})) {
    if (!declaration || !Array.isArray(declaration.tests) || !Array.isArray(declaration.inputs)) throw new Error(`Browser route ${route} needs tests and inputs arrays`);
    for (const test of declaration.tests) for (const input of declaration.inputs) add(test,input);
  }
  for (const [input, tests] of Object.entries(config.contracts || {})) {
    if (!Array.isArray(tests)) throw new Error('contracts maps input paths to arrays of tests');
    for (const test of tests) add(test,input);
  }
  for (const [name, service] of Object.entries(config.services || {})) {
    if (!service || !Array.isArray(service.tests) || !service.tests.length || [service.version !== undefined, service.env !== undefined, service.probe !== undefined].filter(Boolean).length !== 1) throw new Error(`Service ${name} needs tests and exactly one version, env, or probe`);
    for (const test of service.tests) add(test, `service:${name}`);
  }
  return mappings;
}
export function serviceInputs(root, config) {
  const values = {}, warnings = [];
  for (const [name, service] of Object.entries(config.services || {})) {
    let value = service.version;
    if (service.env !== undefined) {
      if (typeof service.env !== 'string') throw new Error('Service env must be a variable name');
      value = config.env?.[service.env] ?? process.env[service.env];
    }
    if (service.probe !== undefined) {
      if (!Array.isArray(service.probe) || !service.probe.length || service.probe.some(s => typeof s !== 'string')) throw new Error('Service probe must be argv');
      const result = spawnSync(service.probe[0],service.probe.slice(1),{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:1024*1024,shell:false,env:{...process.env,...config.env}});
      if (result.error || result.status !== 0) warnings.push({file:`service:${name}`,reason:'service-probe-failed'});
      else value = result.stdout.trim();
    }
    if (value === undefined || value === null || value === '') warnings.push({file:`service:${name}`,reason:'service-version-unavailable'});
    else values[`service:${name}`] = digest(String(value));
  }
  return {values,warnings};
}
export function changedServices(root, config) {
  const current = serviceInputs(root,config);
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(safePath(root,'.tddswarm/services.json'),'utf8')); }
  catch(error) { if(error.code !== 'ENOENT') current.warnings.push({file:'services',reason:'invalid-service-history'}); }
  return {...current,changed:Object.keys(current.values).filter(k=>previous[k]!==current.values[k])};
}
export function rememberServices(root,config,executedTests,expected) {
  const current = serviceInputs(root,config);
  if (current.warnings.length || (expected && digest(current.values)!==digest(expected))) return false;
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(safePath(root,'.tddswarm/services.json'),'utf8')); } catch {}
  for (const [name, service] of Object.entries(config.services || {})) {
    if (service.tests.every(t=>executedTests.includes(t))) previous[`service:${name}`] = current.values[`service:${name}`];
  }
  fs.mkdirSync(safePath(root,'.tddswarm'),{recursive:true});
  fs.writeFileSync(safePath(root,'.tddswarm/services.json'),JSON.stringify(previous,null,2));
}
