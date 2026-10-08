// Prospective qualification protocol only. No model call, prose extraction or repair authority.
export const claudeStructuredContract=Object.freeze({version:'2.1.88',executableSha256:'75c9611929d9a770fe2e3a393219d8b98f5de17fde539b2a7355c6db3fd2795f',formatterTool:'StructuredOutput',terminalField:'structured_output',maximumPayloadBytes:16384});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>JSON.stringify(object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):value);
function parseEvent(line){
  const parsed=JSON.parse(line);let offset=0;
  const space=()=>{while(/\s/.test(line[offset]||'!'))offset++;};
  const string=()=>{const start=offset++;while(offset<line.length){const char=line[offset++];if(char==='\\')offset++;else if(char==='"')return JSON.parse(line.slice(start,offset));}throw new Error('Incomplete JSON string');};
  const scan=depth=>{if(depth>64)throw new Error('Structured event nesting exceeded');space();if(line[offset]==='"'){string();return;}
    if(line[offset]==='{'){offset++;space();const keys=new Set();if(line[offset]==='}'){offset++;return;}while(offset<line.length){const key=string();if(keys.has(key))throw new Error('Duplicate structured event key');keys.add(key);space();offset++;scan(depth+1);space();if(line[offset++]==='}')return;space();}return;}
    if(line[offset]==='['){offset++;space();if(line[offset]===']'){offset++;return;}while(offset<line.length){scan(depth+1);space();if(line[offset++]===']')return;}return;}
    while(offset<line.length&&!/[,}\]\s]/.test(line[offset]))offset++;
  };scan(0);return parsed;
}
function events(stdout,partial=false){
  if(typeof stdout!=='string'||Buffer.byteLength(stdout)>1024*1024)throw new Error('Structured stream byte budget exceeded');
  const lines=stdout.split('\n').filter(line=>line.trim());if(lines.length>2000)throw new Error('Structured stream event budget exceeded');
  return lines.flatMap(line=>{try{const event=parseEvent(line);if(!object(event))throw new Error();return [event];}catch{if(partial)return [];throw new Error('Malformed structured stream event');}});
}
const calls=rows=>rows.flatMap(event=>event.type==='assistant'&&Array.isArray(event.message?.content)?event.message.content.filter(item=>item?.type==='tool_use'&&item.name===claudeStructuredContract.formatterTool):[]);
// Stop on observed formatter failure/repetition. Pipe observation is best effort;
// it cannot attest or prevent every hidden native/provider request.
export function observedStructuredRetry(stdout){
  const rows=events(stdout,true),formatted=calls(rows);
  if(formatted.length>1)return 'native-structured-formatter-repeat-refused';
  const id=formatted[0]?.id;
  if(id&&rows.some(event=>event.type==='user'&&Array.isArray(event.message?.content)&&event.message.content.some(item=>item?.type==='tool_result'&&item.tool_use_id===id&&item.is_error===true)))return 'native-structured-formatter-error-refused';
  if(rows.some(event=>event.type==='result'&&event.subtype==='error_max_structured_output_retries'))return 'native-structured-retries-reported';
  return null;
}
function validatePayload(payload,schema){
  if(!object(schema)||schema.type!=='object'||schema.additionalProperties!==false||!Array.isArray(schema.required)||!object(schema.properties)||!object(payload))throw new Error('Required structured object/schema missing');
  if(JSON.stringify(Object.keys(payload).sort())!==JSON.stringify(schema.required.slice().sort()))throw new Error('Structured account keys mismatch');
  for(const key of schema.required){
    const rule=schema.properties[key],value=payload[key];
    if(rule?.type==='string'){if(typeof value!=='string'||rule.enum&&!rule.enum.includes(value))throw new Error('Structured account string/enum mismatch');}
    else if(rule?.type==='array'){if(!Array.isArray(value)||rule.items?.type!=='string'||value.some(item=>typeof item!=='string'||rule.items.enum&&!rule.items.enum.includes(item)))throw new Error('Structured account array mismatch');}
    else throw new Error('Unsupported structured account schema');
  }
  if(Buffer.byteLength(JSON.stringify(payload))>claudeStructuredContract.maximumPayloadBytes)throw new Error('Structured account payload byte budget exceeded');
}
export function claudeStructuredAccount(stdout,schema){
  try{
    const rows=events(stdout),terminal=rows.filter(event=>event.type==='result'),formatted=calls(rows);
    if(terminal.length!==1||rows.at(-1)!==terminal[0])throw new Error('Exactly one final structured terminal result required');
    const result=terminal[0];if(result.subtype!=='success'||result.is_error!==false||!Object.hasOwn(result,'structured_output'))throw new Error('Successful structured terminal payload missing');
    if(rows.some(event=>event!==result&&Object.hasOwn(event,'structured_output')))throw new Error('Multiple structured terminal payloads');
    if(formatted.length!==1||typeof formatted[0].id!=='string'||!formatted[0].id||formatted[0].id.length>100)throw new Error('Exactly one native formatter invocation required');
    const completions=rows.flatMap(event=>event.type==='user'&&Array.isArray(event.message?.content)?event.message.content.filter(item=>item?.type==='tool_result'&&item.tool_use_id===formatted[0].id):[]);
    if(completions.length!==1||completions[0].is_error===true)throw new Error('Native formatter completion missing or rejected');
    const uses=rows.flatMap((event,index)=>event.type==='assistant'&&Array.isArray(event.message?.content)?event.message.content.filter(item=>item?.type==='tool_use').map(item=>({...item,eventIndex:index})):[]);
    const mcp=uses.filter(item=>item.name?.startsWith('mcp__'));
    const expected=['mcp__testlore_readonly__testlore_brief','mcp__testlore_readonly__testlore_status','mcp__testlore_execution__testlore_plan','mcp__testlore_execution__testlore_verify','mcp__testlore_fixture__repair_fixture','mcp__testlore_execution__testlore_plan','mcp__testlore_execution__testlore_verify'];
    if(JSON.stringify(mcp.map(item=>item.name))!==JSON.stringify(expected)||uses.length!==8)throw new Error('Structured formatter must follow exactly seven authorized MCP calls');
    const finalVerify=mcp.at(-1),formatter=uses.find(item=>item.name===claudeStructuredContract.formatterTool);
    const finalResponses=rows.flatMap((event,index)=>event.type==='user'&&Array.isArray(event.message?.content)?event.message.content.filter(item=>item?.type==='tool_result'&&item.tool_use_id===finalVerify.id).map(item=>({...item,eventIndex:index})):[]);
    if(finalResponses.length!==1||finalResponses[0].is_error===true||finalResponses[0].eventIndex>=formatter.eventIndex)throw new Error('Native formatter preceded final MCP response');
    validatePayload(result.structured_output,schema);validatePayload(formatted[0].input,schema);
    if(canonical(result.structured_output)!==canonical(formatted[0].input))throw new Error('Native formatter/terminal payload mismatch');
    const reason=observedStructuredRetry(stdout);if(reason)throw new Error(reason);
    return {complete:true,finalMessage:JSON.stringify(result.structured_output),formatterInvocations:1,terminalResults:1,proseFallback:false};
  }catch(error){return {complete:false,finalMessage:'',reasons:[error.message],proseFallback:false};}
}
