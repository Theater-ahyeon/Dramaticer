import { chromium } from "@playwright/test";
const out=process.argv[2];const url="file:///E:/agentcoding/Dramaticer/docs/proposals/v4-ui.html";
const b=await chromium.launch();const errs=[];
for(const [name,w,h,scheme,hash] of [["desk-light",1360,900,"light","play"],["desk-dark",1360,900,"dark","play"],["phone-dark",400,860,"dark","play"],["bp-light",1360,900,"light","blueprint"],["sw-dark",1360,900,"dark","switches"],["imp-light",1360,900,"light","import"]]){
  const p=await b.newPage({viewport:{width:w,height:h},colorScheme:scheme});p.on("pageerror",e=>errs.push(name+": "+e.message));p.on("console",m=>{if(m.type()==="error")errs.push(name+": "+m.text())});
  await p.goto(url+"#"+hash);await p.waitForTimeout(1200);
  const ov=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);if(ov>0)errs.push(name+": horizontal overflow "+ov);
  await p.screenshot({path:out+"/"+name+".png",fullPage:name.startsWith("phone")});await p.close()}
await b.close();console.log(errs.length?errs.join("\n"):"NO_ERRORS");
