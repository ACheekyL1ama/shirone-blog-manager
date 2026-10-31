const {test}=require('node:test');
const assert=require('node:assert/strict');
const {launchNpm}=require('../lib/process.cjs');
test('Windows npm launcher correctly quotes commands from a Chinese workspace',async()=>{
  const child=launchNpm(require('node:path').resolve(__dirname,'..'),'--version');
  let output='',errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  assert.equal(code,0,errors);assert.match(output,/\d+\.\d+\.\d+/);
});
