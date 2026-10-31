// End-to-end integration: generate content/settings in an isolated copy, then run the real theme build.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {Blog}=require('../lib/blog.cjs');
const source=fs.realpathSync(process.env.SHIRONE_THEME_DIR||path.resolve(__dirname,'../../shirone'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'shirone-manager-build-'));
const excluded=new Set(['node_modules','.git','dist','.astro','.shirones','research','test-results','playwright-report']);
for(const item of fs.readdirSync(source,{withFileTypes:true}))if(!excluded.has(item.name))fs.cpSync(path.join(source,item.name),path.join(root,item.name),{recursive:true});
fs.symlinkSync(path.join(source,'node_modules'),path.join(root,'node_modules'),'junction');
const blog=new Blog(root,path.join(root,'.manager-test-backups'));
const picture=fs.readFileSync(path.join(root,'src/assets/images/demo-avatar.webp'));
const imported=blog.importMedia(picture,'avatar.webp','image');
const settings=blog.settings();settings.site.title='博客管家集成验证';settings.site.banner.homeText.title='博客管家集成验证';settings.site.banner.src.desktop=[imported];settings.site.banner.src.mobile=[imported];settings.profile.name='测试博主';settings.profile.avatar=imported;settings.music.provider='local';settings.tracks[0].title='管家保存的歌曲';
blog.saveSettings(settings);
blog.savePost({id:'manager-integration/index.md',revision:null,meta:{title:'管家创建的中文文章',published:'2026-10-31',description:'验证可视化编辑生成的内容。',image:imported,tags:['管家测试'],category:'测试',draft:false,pinned:true,comment:false},body:`## 可视化编辑验证\n\n这是一段 **加粗的中文**，还有图片。\n\n![插入的图片](${imported})\n\n- 第一项\n- 第二项\n`});
const lockedMarker='MANAGER_LOCKED_BODY_7b46c8f1';
const lockedPassword='manager-integration-only';
blog.savePost({id:'manager-locked/index.md',revision:null,meta:{title:'管家上锁验证',published:'2026-10-31',description:'MANAGER_PRIVATE_SUMMARY_f0c93',draft:false,encrypted:true,password:lockedPassword,passwordHint:'集成验证提示',hideHomeContent:true},body:`## 上锁正文\n\n${lockedMarker}`});
fs.writeFileSync(path.join(__dirname,'fixture-path.txt'),root);
console.log('Integration fixture:',root);
const child=spawn('cmd.exe',['/d','/s','/c','npm.cmd run build'],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,ASTRO_TELEMETRY_DISABLED:'1'}});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('close',async code=>{
  if(code!==0){process.exitCode=code||1;return;}
  try{await require('./verify-build.cjs').verifyBuild(root);}catch(error){console.error(error);process.exitCode=1;}
});
