const {app,BrowserWindow,ipcMain,dialog,shell,protocol,net} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const tcp = require('node:net');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {Blog} = require('./lib/blog.cjs');
const {launchNpm} = require('./lib/process.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'blog-asset',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
if (!app.requestSingleInstanceLock()) app.quit();
let win,blog,state={},dirty=false,preview=null,job=null,logs=[],closing=false;
const ui = path.join(__dirname,'ui/index.html');
const stateFile=()=>path.join(app.getPath('userData'),'state.json');
function persist() { fs.mkdirSync(path.dirname(stateFile()),{recursive:true}); fs.writeFileSync(stateFile(),JSON.stringify(state,null,2)); }
function connect(root) { blog=new Blog(root,path.join(app.getPath('userData'),'backups')); state.root=blog.root; persist(); return info(); }
function info() { return {root:blog?.root||null,commentAdmin:state.admins?.[blog?.root]||'',busy:!!job,preview:preview?.url||null,logs:logs.slice(-200)}; }
function log(text) { logs.push(String(text)); if(logs.length>600) logs.splice(0,logs.length-600); if(win&&!win.isDestroyed())win.webContents.send('log',String(text)); }
function check() { if(!blog)throw new Error('请先选择 Shirone 博客文件夹。'); }
function writable() {check();if(job)throw new Error('正在执行任务，请等待完成后再保存。');}
function notify() { if(win&&!win.isDestroyed())win.webContents.send('status',info()); }
async function external(value) {
  const url=new URL(value);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('只允许打开普通 http/https 网页。');
  await shell.openExternal(url.href);
}
function spawnNpm(args) {
  return launchNpm(blog.root,args);
}
async function stopPreview() {
  if(!preview)return;
  const active=preview; preview=null;
  if(active.child && active.child.exitCode===null) await new Promise(resolve=> {
    const killer=spawn('taskkill',['/PID',String(active.child.pid),'/T','/F'],{windowsHide:true});
    killer.on('error',resolve);killer.on('close',resolve);
  });
  notify();
}
async function freePort() {return new Promise((resolve,reject)=>{const s=tcp.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}
async function startPreview(open=true) {
  check();if(job)throw new Error('请等待构建任务完成。');
  await stopPreview();
  if(!fs.existsSync(path.join(blog.root,'node_modules/astro')))throw new Error('尚未安装博客依赖，请点击“安装依赖”。');
  const base=new URL(blog.settings().site.base||'/','http://localhost/').pathname;
  const port=await freePort(),url=`http://127.0.0.1:${port}${base}`;
  const child=spawnNpm(`run dev -- --host 127.0.0.1 --port ${port}`);
  const active={child,url};preview=active;notify();
  child.stdout.on('data',chunk=>log(chunk.toString()));child.stderr.on('data',chunk=>log(chunk.toString()));
  child.on('error',error=>{log(error.message);if(preview===active)preview=null;notify();});
  child.on('close',code=>{if(preview===active)preview=null;log(`预览服务已停止（${code}）。`);notify();});
  const deadline=Date.now()+90000;
  while(Date.now()<deadline && preview===active) {
    const ready=await new Promise(resolve=>{const req=http.get(url,res=>{res.resume();resolve(res.statusCode===200);});req.on('error',()=>resolve(false));req.setTimeout(2500,()=>{req.destroy();resolve(false);});});
    if(ready){log('本地预览就绪：'+url);if(open)await external(url);return {url};}
    await new Promise(resolve=>setTimeout(resolve,700));
  }
  throw new Error('预览未能启动，请展开运行日志查看原因。');
}
async function runJob(type) {
  writable();await stopPreview();
  let args;
  if(type==='build')args='run build';
  else if(type==='install') {
    const manager=JSON.parse(fs.readFileSync(path.join(blog.root,'package.json'),'utf8')).packageManager;
    if(!/^pnpm@\d+\.\d+\.\d+$/.test(manager))throw new Error('项目没有有效的 pnpm 版本配置。');
    args=`exec --yes --package=${manager} -- pnpm install --frozen-lockfile`;
  }else throw new Error('未知任务。');
  const child=spawnNpm(args);job={child,type};log(type==='build'?'开始构建博客…':'开始安装博客依赖…');notify();
  child.stdout.on('data',chunk=>log(chunk.toString()));child.stderr.on('data',chunk=>log(chunk.toString()));
  const active=job;
  const done=(code,error)=>{if(job!==active)return;job=null;const success=code===0&&!error;log(success?'任务完成。':`任务失败：${error?.message||'退出码 '+code}`);notify();if(win&&!win.isDestroyed())win.webContents.send('task-done',{type,success});};
  child.on('error',error=>done(-1,error));child.on('close',code=>done(code));
  return {started:true};
}

app.whenReady().then(()=>{
  try{state=JSON.parse(fs.readFileSync(stateFile(),'utf8'));}catch{}
  const location=process.env.PORTABLE_EXECUTABLE_DIR||(app.isPackaged?path.dirname(process.execPath):__dirname);
  const guesses=[state.root,path.resolve(location,'shirone'),path.resolve(location,'../shirone'),path.resolve(process.cwd(),'shirone')];
  for(const root of guesses.filter(Boolean)){try{connect(root);break;}catch{}}
  protocol.handle('blog-asset',request=>{
    try {
      check();const url=new URL(request.url);const relative=decodeURIComponent(url.pathname).replace(/^\//,'');
      const prefix={public:'public',posts:'src/content/posts',src:'src'}[url.hostname];
      if(!prefix||! /\.(png|jpe?g|webp|gif|avif|mp3|ogg|wav|m4a|flac)$/i.test(relative))return new Response('Forbidden',{status:403});
      return net.fetch(pathToFileURL(blog.file(prefix+'/'+relative)).href);
    }catch{return new Response('Not found',{status:404});}
  });
  function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{
    if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('非法请求。');
    try{return {ok:true,value:await fn(...args)};}catch(error){return {ok:false,error:error.message};}
  });}
  handle('info',info);
  handle('choose-project',async()=>{if(dirty)throw new Error('请先保存当前修改。');if(job)throw new Error('请等待当前任务结束。');const result=await dialog.showOpenDialog(win,{title:'选择 Shirone 博客文件夹',properties:['openDirectory']});if(result.canceled)return null;await stopPreview();return connect(result.filePaths[0]);});
  handle('posts',()=>{check();return blog.listPosts();});
  handle('read-post',id=>{check();return blog.readPost(id);});
  handle('save-post',input=>{writable();return blog.savePost(input);});
  handle('archive-post',input=>{writable();return blog.archivePost(input.id,input.revision);});
  handle('settings',()=>{check();return blog.settings();});
  handle('save-settings',async input=>{writable();if(input.commentAdmin){const url=new URL(input.commentAdmin);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('管理后台地址必须使用普通 http 或 https 地址。');}const result=blog.saveSettings(input);state.admins||={};state.admins[blog.root]=input.commentAdmin||'';persist();if(preview)await stopPreview();return result;});
  handle('pick-media',async kind=>{writable();const result=await dialog.showOpenDialog(win,{title:kind==='audio'?'导入音乐':'选择图片',properties:['openFile'],filters:[{name:kind==='audio'?'音频':'图片',extensions:kind==='audio'?['mp3','ogg','wav','m4a','flac']:['png','jpg','jpeg','webp','gif','avif']}]});if(result.canceled)return null;const file=result.filePaths[0];return blog.importMedia(fs.readFileSync(file),path.basename(file),kind);});
  handle('import-image',input=>{writable();if(!input?.bytes||input.bytes.length>30*1024*1024)throw new Error('图片过大或格式不正确。');return blog.importMedia(Buffer.from(input.bytes),input.name,'image');});
  handle('preview',()=>startPreview());
  handle('stop-preview',()=>stopPreview());
  handle('run-task',type=>runJob(type));
  handle('open-project',()=>{check();return shell.openPath(blog.root);});
  handle('open-output',()=>{check();const dir=path.join(blog.root,'dist');if(!fs.existsSync(dir))throw new Error('还没有构建产物，请先点击构建。');return shell.openPath(dir);});
  handle('open-comments',async()=>{check();const setting=blog.settings().comment;const custom=state.admins?.[blog.root];if(custom)return external(custom);if(setting.provider==='waline'&&setting.waline.serverURL)return external(setting.waline.serverURL.replace(/\/$/,'')+'/ui/');if(setting.provider==='giscus'&&/^[\w.-]+\/[\w.-]+$/.test(setting.giscus.repo))return external('https://github.com/'+setting.giscus.repo+'/discussions');throw new Error('请先填写评论管理后台地址。Twikoo 可填写已部署博客的文章地址，在评论组件内登录管理。');});
  handle('backups',()=>{check();return blog.backups();});
  handle('restore',async id=>{writable();const result=await dialog.showMessageBox(win,{type:'question',buttons:['取消','恢复'],defaultId:0,cancelId:0,message:'恢复这次保存前的内容？',detail:'当前内容会先自动备份。恢复新建文章时会将它设为草稿。'});if(result.response!==1)return null;await stopPreview();return blog.restore(id);});
  handle('dirty',value=>{dirty=!!value;win.setDocumentEdited(dirty);return null;});
  win=new BrowserWindow({width:1440,height:940,minWidth:1100,minHeight:760,title:'Shirone 博客管家',icon:path.join(__dirname,'ui/assets/app.png'),backgroundColor:'#f6f5fa',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.on('close',event=>{
    if(closing)return;
    event.preventDefault();
    if((dirty||job)&&dialog.showMessageBoxSync(win,{type:'question',buttons:['继续使用','退出'],defaultId:0,cancelId:0,message:job?'后台任务尚未完成，退出将终止任务。':'有尚未保存的修改，确定退出？'})!==1)return;
    closing=true;
    (async()=>{await stopPreview();if(job){await new Promise(resolve=>{const kill=spawn('taskkill',['/PID',String(job.child.pid),'/T','/F'],{windowsHide:true});kill.on('error',resolve);kill.on('close',resolve);});}app.quit();})();
  });
  win.loadFile(ui);
});
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
app.on('window-all-closed',()=>app.quit());
