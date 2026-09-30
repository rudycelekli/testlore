import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const MAX_EVENTS=2000,MAX_SCRIPTS=256,MAX_RANGES=10000,MAX_BYTES=2*1024*1024;
function cleanURL(raw){try{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol))return null;url.username='';url.password='';url.search='';url.hash='';return url.href;}catch{return null;}}
/** Opt-in extension of the project's installed Playwright test. No SDK import or browser installation. */
export function createBrowserTest(baseTest){
  return baseTest.extend({
    page:async({page,browserName,context},use,testInfo)=>{
      const directory=process.env.TESTLORE_BROWSER_CAPTURE_DIRECTORY;
      if(!directory){await use(page);return;}
      const report={schemaVersion:1,nativeId:testInfo.testId,repeatEachIndex:testInfo.repeatEachIndex,retry:testInfo.retry,browserName,browserVersion:context.browser()?.version()||'unknown',requests:[],routes:[],coverage:{javascript:[],css:[]},warnings:[]};
      let overflow=false, extraPages=false, started=false;
      const requestListener=response=>{if(report.requests.length>=MAX_EVENTS){overflow=true;return;}const request=response.request(),url=cleanURL(response.url());if(url)report.requests.push({url,type:request.resourceType(),status:response.status()});};
      const routeListener=frame=>{if(frame!==page.mainFrame())return;const url=cleanURL(frame.url());if(url&&url!=='about:blank'){if(report.routes.length>=MAX_EVENTS)overflow=true;else report.routes.push(url);}};
      const pageListener=other=>{if(other!==page)extraPages=true;};
      page.on('response',requestListener);page.on('framenavigated',routeListener);context.on('page',pageListener);
      try{
        if(browserName==='chromium'){await page.coverage.startJSCoverage({resetOnNavigation:false,reportAnonymousScripts:false});await page.coverage.startCSSCoverage({resetOnNavigation:false});started=true;}
        else report.warnings.push('coverage-unavailable-for-browser');
        await use(page);
      }finally{
        if(started){
          try{
            const js=await page.coverage.stopJSCoverage(),css=await page.coverage.stopCSSCoverage();let count=0;
            function add(entries,kind){if(entries.length>MAX_SCRIPTS)overflow=true;for(const entry of entries.slice(0,MAX_SCRIPTS)){const url=cleanURL(entry.url);if(!url)continue;const ranges=kind==='javascript'?(entry.functions||[]).flatMap(fn=>fn.ranges||[]).filter(range=>range.count>0).map(range=>({start:range.startOffset,end:range.endOffset})):(entry.ranges||[]);count+=ranges.length;if(count>MAX_RANGES){overflow=true;break;}report.coverage[kind].push({url,ranges});}}
            add(js,'javascript');add(css,'css');
          }catch{report.warnings.push('coverage-capture-failed');}
        }
        page.off('response',requestListener);page.off('framenavigated',routeListener);context.off('page',pageListener);
        if(extraPages)report.warnings.push('additional-pages-unobserved');if(overflow)report.warnings.push('capture-limit-exceeded');if(!report.routes.length)report.warnings.push('no-observed-route');
        report.complete=started&&!report.warnings.length;
        const text=JSON.stringify(report);const key=createHash('sha256').update(JSON.stringify([report.nativeId,report.repeatEachIndex,report.retry])).digest('hex');
        fs.mkdirSync(directory,{recursive:true});
        if(Buffer.byteLength(text)>MAX_BYTES){report.requests=[];report.coverage={javascript:[],css:[]};report.complete=false;report.warnings.push('capture-limit-exceeded');}
        fs.writeFileSync(path.join(directory,key+'.json'),JSON.stringify(report),{flag:'wx'});
      }
    }
  });
}
