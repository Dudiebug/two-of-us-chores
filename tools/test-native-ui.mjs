import vm from "node:vm";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const code = await readFile(new URL('../public/native-app.js',import.meta.url),'utf8');
for (const initial of ['prompt','granted','denied']) {
  let permission=initial, configured=false, asked=0, posted=0;
  const nodes=new Map();const storage=new Map();
  const plugin={getStatus:async()=>({notifications:permission,configured}),requestPermissions:async()=>{asked++;permission='granted';return {notifications:permission}},getFirebaseToken:async()=>({token:'fcm-token:abcdefghijklmnopqrstuvwxyz'}),configure:async()=>{configured=true},disable:async()=>{configured=false},openSettings:async()=>{},pollNow:async()=>({posted:++posted})};
  const context={window:{Capacitor:{getPlatform:()=> 'android',Plugins:{ChoresNotifications:plugin}}},navigator:{userAgent:'ChoresCapacitor/1.3'},document:{querySelector:(s)=>{if(!nodes.has(s))nodes.set(s,{});return nodes.get(s)},addEventListener:()=>{}},localStorage:{getItem:(k)=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID:()=> 'test-native-device'},fetch:async()=>({ok:true,text:async()=>JSON.stringify({token:'test-token-long-enough',cursor:0})}),setTimeout,Date,console};
  vm.runInNewContext(code,context);
  await context.window.ChoresNative.initialize();
  assert.equal(asked,initial==='prompt'?1:0);
  if(initial==='prompt'){assert.equal(configured,true);await context.window.ChoresNative.test();assert.equal(posted,1)}
  await context.window.ChoresNative.refresh();
  assert.ok(!nodes.get('#pushStatus').textContent.includes('unavailable'));
}
const context={window:{},navigator:{userAgent:'Chrome'},console};vm.runInNewContext(code,context);assert.equal(context.window.ChoresNative,undefined);
console.log('Native UI decisions: prompt, existing permission, denial, browser separation PASS');
