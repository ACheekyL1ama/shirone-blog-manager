const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Blog,parsePost,patchTS,parseTS,literal}=require('../lib/blog.cjs');
let temp,root,blog;
beforeEach(()=>{
  temp=fs.mkdtempSync(path.join(os.tmpdir(),'shirone-manager-test-'));root=path.join(temp,'blog');
  fs.mkdirSync(path.join(root,'src/config'),{recursive:true});fs.mkdirSync(path.join(root,'src/data'),{recursive:true});fs.mkdirSync(path.join(root,'src/content/posts'),{recursive:true});
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{build:'astro build',dev:'astro dev'}}));
  const source=process.env.SHIRONE_THEME_DIR||path.resolve(__dirname,'../../shirone');
  for(const file of ['siteConfig','profileConfig','musicConfig','commentConfig'])fs.copyFileSync(path.join(source,'src/config',file+'.ts'),path.join(root,'src/config',file+'.ts'));
  fs.copyFileSync(path.join(source,'src/data/music.ts'),path.join(root,'src/data/music.ts'));
  blog=new Blog(root,path.join(temp,'backups'));
});
afterEach(()=>fs.rmSync(temp,{recursive:true,force:true}));
test('AST updates preserve comments, other fields and escaped strings',()=>{
  const old=blog.read('src/config/siteConfig.ts');
  const updated=patchTS(old,'siteConfig',{title:'中文 "博客"\n第二行','banner.homeText.title':'你好'});
  assert.ok(updated.includes('// 电脑端顶栏标题'));
  assert.equal(literal(parseTS(updated,'siteConfig').node,parseTS(updated,'siteConfig').source).lang,literal(parseTS(old,'siteConfig').node,parseTS(old,'siteConfig').source).lang);
  const parsed=parseTS(updated,'siteConfig');assert.equal(literal(parsed.node,parsed.source).title,'中文 "博客"\n第二行');
});
test('settings no-op never rewrites config and changed values have backups',()=>{
  const settings=blog.settings();assert.equal(blog.saveSettings(settings).changed,false);assert.equal(blog.backups().length,0);
  const original=blog.read('src/config/siteConfig.ts');settings.site.title='我的博客';settings.profile.name='测试博主';settings.tracks[0].title='新歌';
  blog.saveSettings(settings);assert.equal(blog.settings().site.title,'我的博客');assert.equal(blog.settings().tracks[0].title,'新歌');
  assert.equal(blog.backups().length,1);blog.restore(blog.backups()[0].id);assert.equal(blog.read('src/config/siteConfig.ts'),original);
});
test('settings reject missing services, invalid links, empty banners and stale writes',()=>{
  let s=blog.settings();s.comment.enable=true;s.comment.provider='giscus';assert.throws(()=>blog.saveSettings(s),/GitHub/);
  s=blog.settings();s.site.banner.src.desktop=[];assert.throws(()=>blog.saveSettings(s),/至少/);
  s=blog.settings();const another=blog.settings();another.profile.name='changed';blog.saveSettings(another);assert.throws(()=>blog.saveSettings(s),/其他程序/);
});
test('article saves preserve unknown YAML, comments, advanced body and fix date conflicts',()=>{
  const source='---\ntitle: 原标题\npublished: 2026-10-30\npublishedAt: 2026-10-30T12:00:00+08:00\n# custom configuration\nseries: my-series\ncustom: keep-me\n---\n\n:::note\n保留 **正文**\n:::\n';
  fs.writeFileSync(blog.file('src/content/posts/existing.md'),source);
  let post=blog.readPost('existing.md');assert.equal(post.advanced,true);post.meta.title='新标题';post.meta.published='2026-10-31';post.meta.draft=true;
  post=blog.savePost(post);assert.equal(post.meta.custom,'keep-me');assert.equal(post.meta.series,'my-series');assert.equal(post.meta.publishedAt,undefined);assert.equal(post.body.trim(),':::note\n保留 **正文**\n:::');
  assert.ok(blog.read('src/content/posts/existing.md').includes('# custom configuration'));
  assert.ok(blog.read('src/content/posts/existing.md').includes('published: 2026-10-31'));
});
test('new documents, draft archive, revision guard and restore are safe',()=>{
  const post=blog.savePost({id:'new/index.md',revision:null,meta:{title:'新文章',published:'2026-10-31',draft:false,tags:['中文']},body:'## 标题\n\n内容'});
  assert.equal(blog.listPosts()[0].title,'新文章');assert.equal(blog.readPost(post.id).body.trim(),'## 标题\n\n内容');
  assert.throws(()=>blog.savePost({...post,revision:'stale'}),/其他位置/);
  blog.archivePost(post.id,post.revision);assert.equal(blog.readPost(post.id).meta.draft,true);
  const creation=blog.backups().find(b=>b.entries.some(e=>!e.existed));blog.restore(creation.id);assert.equal(blog.readPost(post.id).meta.draft,true);
});
test('article locking supports required passwords, editing, rotation and removing the lock',()=>{
  const input={id:'locked/index.md',revision:null,meta:{title:'上锁文章',published:'2026-10-31',encrypted:true,password:'',passwordHint:'提示',hideHomeContent:true,draft:false},body:'## 私密正文\n\n正文应当保持可编辑。'};
  assert.throws(()=>blog.savePost(input),/填写阅读密码/);
  assert.equal(fs.existsSync(blog.file('src/content/posts/locked/index.md')),false);
  assert.equal(blog.backups().length,0);
  input.meta.password='中文 "测试" : # 123';
  let saved=blog.savePost(input);
  assert.equal(saved.meta.password,input.meta.password);assert.equal(saved.meta.encrypted,true);assert.equal(saved.advanced,false);
  assert.equal(blog.listPosts().find(p=>p.id===input.id).encrypted,true);
  saved.body+='\n\n继续写作。';saved=blog.savePost(saved);
  assert.ok(saved.body.includes('继续写作。'));assert.equal(saved.meta.password,input.meta.password);
  saved.meta.password='新的密码';saved.meta.passwordHint='新提示';saved.meta.hideHomeContent=false;saved=blog.savePost(saved);
  assert.equal(saved.meta.password,'新的密码');assert.equal(saved.meta.passwordHint,'新提示');assert.equal(saved.meta.hideHomeContent,false);
  saved=blog.archivePost(saved.id,saved.revision);assert.equal(saved.meta.encrypted,true);assert.equal(saved.meta.password,'新的密码');
  saved.meta.encrypted=false;saved=blog.savePost(saved);
  assert.equal(saved.meta.encrypted,false);assert.equal(saved.meta.password,undefined);assert.equal(saved.meta.passwordHint,undefined);assert.equal(blog.listPosts().find(p=>p.id===saved.id).encrypted,false);
  const beforeUnlock=blog.backups().find(b=>b.label==='保存文章：上锁文章');blog.restore(beforeUnlock.id);
  assert.equal(blog.readPost(saved.id).meta.encrypted,true);assert.equal(blog.readPost(saved.id).meta.password,'新的密码');
});
test('saving legacy locked posts preserves omitted lock fields and numeric passwords',()=>{
  const file='src/content/posts/legacy.md';fs.writeFileSync(blog.file(file),'---\ntitle: 旧文章\npublished: 2026-10-31\nencrypted: true\npassword: 12345\npasswordHint: 旧提示\n---\n\n原始正文');
  const post=blog.readPost('legacy.md');const saved=blog.savePost({id:post.id,revision:post.revision,meta:{title:'修改标题',published:'2026-10-31'},body:post.body});
  assert.equal(saved.meta.encrypted,true);assert.equal(saved.meta.password,'12345');assert.equal(saved.meta.passwordHint,'旧提示');assert.equal(saved.body.trim(),'原始正文');
});
test('path traversal and symbolic link escapes are blocked; media are copied by content',()=>{
  assert.throws(()=>blog.file('../outside'),/之外/);assert.throws(()=>blog.readPost('../../outside.md'),/无效/);
  const outside=path.join(temp,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(root,'escape'),'junction');
  assert.throws(()=>blog.file('escape/test.txt'),/链接/);
  const data=Buffer.from('test audio');const imported=blog.importMedia(data,'my.mp3','audio');assert.ok(imported.startsWith('/manager-media/audio/'));assert.deepEqual(fs.readFileSync(blog.file('public'+imported)),data);
  assert.equal(blog.importMedia(data,'same.mp3','audio'),imported);assert.throws(()=>blog.importMedia(data,'bad.exe','image'),/格式/);
});
