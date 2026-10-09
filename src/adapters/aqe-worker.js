#!/usr/bin/env node
import {aqeGenerate} from './aqe.js';
const allowed=new Set(['OPENAI_API_KEY','ANTHROPIC_API_KEY','GOOGLE_AI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','OPENROUTER_API_KEY']);
let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>65536)throw new Error('AQE worker request exceeds budget');}
const request=JSON.parse(input),root=process.cwd();
if(!Array.isArray(request.envNames)||request.envNames.some(name=>!allowed.has(name)))throw new Error('Invalid AQE worker environment names');
const environment=Object.fromEntries(request.envNames.map(name=>[name,process.env[name]]).filter(([,value])=>typeof value==='string'));
try{process.stdout.write(JSON.stringify({artifact:aqeGenerate(root,{...request.options,env:environment})}));}
catch(error){const artifacts=error.artifact?[error.artifact]:[];let message=error.message;for(const value of Object.values(environment))if(value)message=message.split(value).join('[REDACTED]');process.stdout.write(JSON.stringify({error:message,artifacts}));}
