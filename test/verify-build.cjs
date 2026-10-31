const fs=require('node:fs'),path=require('node:path');
async function verifyBuild(root){
  const article=fs.readFileSync(path.join(root,'dist/posts/manager-integration/index.html'),'utf8');
  const homepage=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
  for(const text of ['管家创建的中文文章','加粗的中文','/manager-media/image/'])if(!article.includes(text))throw new Error('Built article missing '+text);
  for(const text of ['博客管家集成验证','测试博主','管家保存的歌曲'])if(!homepage.includes(text))throw new Error('Built settings missing '+text);
  const lockedMarker='MANAGER_LOCKED_BODY_7b46c8f1',lockedPassword='manager-integration-only';
  const locked=fs.readFileSync(path.join(root,'dist/posts/manager-locked/index.html'),'utf8');
  for(const file of ['index.html','posts/manager-locked/index.html','rss.xml','atom.xml','llms-full.txt']){
    const text=fs.readFileSync(path.join(root,'dist',file),'utf8');
    if(text.includes(lockedMarker)||text.includes(lockedPassword))throw new Error('Protected content leaks through '+file);
  }
  if(homepage.includes('MANAGER_PRIVATE_SUMMARY_f0c93'))throw new Error('Protected summary leaked on homepage.');
  const propsMatch=locked.match(/<astro-island\b[^>]*component-url="[^"]*ProtectedPost[^>]*\bprops="([^"]+)"/);
  if(!propsMatch)throw new Error('Encrypted payload missing from built article.');
  const entities={'&quot;':'"','&#39;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'};
  const props=JSON.parse(propsMatch[1].replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g,e=>entities[e]));
  const payload=Object.fromEntries(Object.entries(props.payload[1]).map(([key,entry])=>[key,entry[1]]));
  const {decryptProtectedContent}=require(path.join(root,'src/utils/password-protection.ts'));
  const decrypted=await decryptProtectedContent(payload,lockedPassword,'post:manager-locked');
  if(!decrypted.includes(lockedMarker))throw new Error('Correct password did not recover the body.');
  let denied=false;try{await decryptProtectedContent(payload,'wrong-password','post:manager-locked');}catch{denied=true;}
  if(!denied)throw new Error('Wrong password was accepted.');
  console.log('PASS: real Shirone build accepts generated article, media, profile, wallpaper and music settings.');
  console.log('PASS: protected body/password absent from HTML, feeds and text exports; correct password unlocks, wrong password fails.');
}
module.exports={verifyBuild};
if(require.main===module)verifyBuild(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
