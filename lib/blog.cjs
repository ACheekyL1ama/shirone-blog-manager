const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const YAML = require('yaml');

const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const configFiles = {
  site: ['src/config/siteConfig.ts', 'siteConfig'],
  profile: ['src/config/profileConfig.ts', 'profileConfig'],
  music: ['src/config/musicConfig.ts', 'musicConfig'],
  comment: ['src/config/commentConfig.ts', 'commentConfig'],
};

function parseTS(text, name) {
  const source = ts.createSourceFile('config.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) throw new Error('配置文件有语法错误，请先修复，管家不会覆盖它。');
  let node;
  function visit(item) {
    if (ts.isVariableDeclaration(item) && item.name.getText(source) === name) {
      node = item.initializer;
      if (node && ts.isCallExpression(node) && node.expression.getText(source) === 'withUserConfig') node = node.arguments[1];
    }
    ts.forEachChild(item, visit);
  }
  visit(source);
  if (!node) throw new Error(`未找到配置 ${name}，此主题版本暂不兼容。`);
  return { source, node };
}

function literal(node, source) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -literal(node.operand, source);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(item => literal(item, source));
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(p => [p.name.text ?? p.name.getText(source), literal(p.initializer, source)]));
  return undefined;
}

function patchTS(text, name, changes) {
  const { source, node } = parseTS(text, name);
  const edits = [];
  for (const [key, value] of Object.entries(changes)) {
    let current = node;
    for (const part of key.split('.')) {
      if (!ts.isObjectLiteralExpression(current)) throw new Error(`无法定位配置项 ${key}`);
      const property = current.properties.find(p => ts.isPropertyAssignment(p) && (p.name.text ?? p.name.getText(source)) === part);
      if (!property) throw new Error(`主题缺少配置项 ${key}，请勿直接保存。`);
      current = property.initializer;
    }
    edits.push({ start: current.getStart(source), end: current.end, text: JSON.stringify(value, null, '\t') });
  }
  edits.sort((a,b) => b.start-a.start);
  for (let i=1;i<edits.length;i++) if (edits[i-1].start < edits[i].end) throw new Error('配置更新范围重叠。');
  for (const edit of edits) text = text.slice(0,edit.start) + edit.text + text.slice(edit.end);
  parseTS(text, name);
  return text;
}

function parsePost(text) {
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('文章缺少开头的 --- 信息区，无法编辑。');
  const doc = YAML.parseDocument(match[1]);
  if (doc.errors.length) throw new Error(`文章信息格式错误：${doc.errors[0].message}`);
  return { doc, meta: doc.toJS() || {}, body: text.slice(match[0].length) };
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('请选择有效的发布日期。');
}

class Blog {
  constructor(root, backupRoot) {
    this.root = fs.realpathSync(root);
    this.backupRoot = path.join(backupRoot, hash(this.root).slice(0,16));
    if (!fs.existsSync(path.join(this.root, 'src/config/siteConfig.ts')) || !fs.existsSync(path.join(this.root, 'src/content/posts'))) throw new Error('请选择 Shirone 项目根目录（里面应有 src 和 package.json）。');
    const packageInfo = JSON.parse(fs.readFileSync(path.join(this.root,'package.json'),'utf8'));
    if (!packageInfo.scripts?.build || !packageInfo.scripts?.dev) throw new Error('项目缺少构建或预览命令。');
    if (fs.existsSync(path.join(this.root,'shirone.content.json'))) throw new Error('此版本管家适用于本地内容模式，请先将外部内容迁回本地后再连接。');
  }
  file(relative) {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('无效的文件路径。');
    const result = path.resolve(this.root, relative);
    if (!result.startsWith(this.root + path.sep)) throw new Error('不能访问博客目录之外的文件。');
    let ancestor = result;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const real = fs.realpathSync(ancestor);
    if (real !== this.root && !real.startsWith(this.root + path.sep)) throw new Error('不能通过链接写入博客目录之外。');
    return result;
  }
  read(relative) { return fs.readFileSync(this.file(relative), 'utf8'); }
  revision(files) { return hash(files.map(f => this.read(f)).join('\0')); }
  transaction(updates, label) {
    const changed = Object.entries(updates).filter(([relative,text]) => !fs.existsSync(this.file(relative)) || this.read(relative) !== text);
    if (!changed.length) return { changed: false };
    const id = new Date().toISOString().replace(/[:.]/g,'-') + '-' + crypto.randomBytes(3).toString('hex');
    const dir = path.join(this.backupRoot,id);
    fs.mkdirSync(dir, { recursive: true });
    const entries = changed.map(([relative]) => ({ relative, existed: fs.existsSync(this.file(relative)) }));
    for (const entry of entries) if (entry.existed) {
      const target = path.join(dir,'files',entry.relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(this.file(entry.relative),target);
    }
    fs.writeFileSync(path.join(dir,'manifest.json'), JSON.stringify({ id, label, time: new Date().toISOString(), entries },null,2));
    const completed = [];
    try {
      for (const [relative,text] of changed) {
        const target = this.file(relative);
        fs.mkdirSync(path.dirname(target),{recursive:true});
        const temp = target + '.manager-' + crypto.randomBytes(4).toString('hex');
        try { fs.writeFileSync(temp,text); fs.renameSync(temp,target); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
        completed.push(relative);
      }
    } catch (error) {
      for (const relative of completed) {
        const entry = entries.find(e => e.relative === relative);
        if (entry.existed) fs.copyFileSync(path.join(dir,'files',relative), this.file(relative));
        else fs.unlinkSync(this.file(relative));
      }
      throw error;
    }
    return { changed:true, backup:id };
  }
  settings() {
    const result = {};
    for (const [domain,[file,name]] of Object.entries(configFiles)) {
      const {node,source} = parseTS(this.read(file),name);
      result[domain] = literal(node,source);
    }
    const {node,source} = parseTS(this.read('src/data/music.ts'),'musicTracks');
    result.tracks = literal(node,source);
    result.revision = this.revision([...Object.values(configFiles).map(v=>v[0]),'src/data/music.ts']);
    return clone(result);
  }
  saveSettings(input) {
    const old = this.settings();
    if (old.revision !== input.revision) throw new Error('配置已被其他程序修改，请重新加载后再保存。');
    const {site,profile,music,comment,tracks} = input;
    if (!site.title?.trim() || !profile.name?.trim()) throw new Error('博客名称和昵称不能为空。');
    for (const images of [site.banner.src.desktop,site.banner.src.mobile]) if (!Array.isArray(images)||!images.length||images.some(image=>typeof image!=='string'||!image.trim())) throw new Error('电脑和手机背景都至少需要一张图片。');
    for (const value of [site.site,comment.waline.serverURL,comment.twikoo.envId]) if (value && value.includes('://') && !/^https?:\/\//i.test(value)) throw new Error('服务地址只支持 http 或 https。');
    if (!/^https?:\/\//i.test(site.site)) throw new Error('网站地址应以 http:// 或 https:// 开头。');
    if (!['local','mixed','meting'].includes(music.provider)) throw new Error('请选择有效的音乐模式。');
    if (!['none','waline','giscus','twikoo'].includes(comment.provider)) throw new Error('请选择有效的评论服务。');
    if (comment.enable) {
      if (comment.provider === 'none') throw new Error('开启评论时需要选择评论服务。');
      if (comment.provider === 'waline' && !/^https?:\/\//i.test(comment.waline.serverURL)) throw new Error('请填写 Waline 服务地址。');
      if (comment.provider === 'twikoo' && !comment.twikoo.envId.trim()) throw new Error('请填写 Twikoo 环境 ID 或服务地址。');
      if (comment.provider === 'giscus' && (!/^[\w.-]+\/[\w.-]+$/.test(comment.giscus.repo) || !comment.giscus.repoId || !comment.giscus.categoryId)) throw new Error('请填写 GitHub 仓库、仓库 ID 和分类 ID。');
    }
    if (!Number.isFinite(site.themeColor.hue) || site.themeColor.hue < 0 || site.themeColor.hue > 360) throw new Error('主题色应在 0–360 之间。');
    if (music.provider !== 'meting' && !tracks.length && music.enable) throw new Error('请添加音乐，或关闭音乐播放器。');
    const ids = new Set();
    for (const track of tracks) {
      if (!track.id || ids.has(track.id) || !track.title?.trim() || !track.source?.trim()) throw new Error('每首音乐需要唯一 ID、名称和音频地址。');
      if (!/^\/|^https?:\/\//i.test(track.source)) throw new Error('音频应使用导入后的路径或 http/https 链接。');
      ids.add(track.id);
    }
    const changes = {
      site: { title:site.title, subtitle:site.subtitle, site:site.site, 'themeColor.hue':site.themeColor.hue, 'banner.src.desktop':site.banner.src.desktop, 'banner.src.mobile':site.banner.src.mobile, 'banner.homeText.title':site.banner.homeText.title, 'banner.homeText.subtitle':site.banner.homeText.subtitle },
      profile: { name:profile.name, bio:profile.bio, avatar:profile.avatar },
      music: { enable:music.enable, provider:music.provider, 'meting.server':music.meting.server, 'meting.type':music.meting.type, 'meting.id':music.meting.id },
      comment: { enable:comment.enable, provider:comment.provider, 'twikoo.envId':comment.twikoo.envId, 'waline.serverURL':comment.waline.serverURL, 'giscus.repo':comment.giscus.repo, 'giscus.repoId':comment.giscus.repoId, 'giscus.categoryId':comment.giscus.categoryId },
    };
    const updates = {};
    for (const [domain,patch] of Object.entries(changes)) {
      const [file,name] = configFiles[domain];
      // Touch only values changed by the user; preserve all other comments and formatting.
      const different = Object.fromEntries(Object.entries(patch).filter(([key,value]) => JSON.stringify(key.split('.').reduce((v,k)=>v?.[k],old[domain])) !== JSON.stringify(value)));
      if (Object.keys(different).length) updates[file] = patchTS(this.read(file),name,different);
    }
    if (JSON.stringify(tracks) !== JSON.stringify(old.tracks)) {
      const file = 'src/data/music.ts';
      const text = this.read(file), {node,source} = parseTS(text,'musicTracks');
      updates[file] = text.slice(0,node.getStart(source)) + JSON.stringify(tracks,null,'\t') + text.slice(node.end);
    }
    return this.transaction(updates,'更新博客设置');
  }
  listPosts() {
    const result = [];
    const walk = relative => {
      for (const item of fs.readdirSync(this.file(relative),{withFileTypes:true})) {
        if (item.isSymbolicLink()) continue;
        const entry = relative+'/'+item.name;
        if (item.isDirectory()) walk(entry);
        else if (/\.mdx?$/i.test(item.name)) {
          const id = entry.slice('src/content/posts/'.length);
          try { const {meta} = parsePost(this.read(entry)); result.push({id,title:meta.title || id,published:String(meta.published||''),draft:!!meta.draft,pinned:!!meta.pinned,encrypted:!!meta.encrypted,category:meta.category||''}); }
          catch(error) { result.push({id,title:id,error:error.message}); }
        }
      }
    };
    walk('src/content/posts');
    return result.sort((a,b)=>(b.published||'').localeCompare(a.published||''));
  }
  postFile(id) {
    if (typeof id !== 'string' || !/\.mdx?$/.test(id) || /[:*?"<>|]/.test(id) || id.split(/[\\/]/).some(part => !part || part === '..' || part === '.')) throw new Error('文章路径无效。');
    const relative = 'src/content/posts/'+id;
    this.file(relative);
    return relative;
  }
  readPost(id) {
    const text = this.read(this.postFile(id));
    const {meta,body} = parsePost(text);
    return {id,meta,body,revision:hash(text),advanced:/\.mdx$/.test(id) || /^\s*(:|\$\$|import |export |<|```(?:mermaid|plantuml))/m.test(body) || /\$[^\n$]+\$|\[\^[^\]]+\]/.test(body)};
  }
  savePost(input) {
    const file = this.postFile(input.id), exists = fs.existsSync(this.file(file));
    if (exists && (!input.revision || hash(this.read(file)) !== input.revision)) throw new Error('文章已在其他位置修改，或名称已存在。请重新打开再保存。');
    if (!exists && input.revision) throw new Error('文章已被移动或删除，请重新加载列表。');
    if (!input.meta.title?.trim()) throw new Error('请填写文章标题。');
    validateDate(input.meta.published);
    const {doc,meta:original} = exists ? parsePost(this.read(file)) : {doc:new YAML.Document(),meta:{}};
    const encrypted = input.meta.encrypted ?? original.encrypted ?? false;
    if (typeof encrypted !== 'boolean') throw new Error('文章上锁开关必须为开启或关闭。');
    const password = String(input.meta.password ?? original.password ?? '');
    if (encrypted && !password.trim()) throw new Error('已开启文章上锁，请填写阅读密码。');
    for (const key of ['title','published','description','image','tags','category','draft','pinned','comment','encrypted','passwordHint','hideHomeContent']) if (input.meta[key] !== undefined) doc.set(key,input.meta[key]);
    if (encrypted) doc.set('password',password);
    else if (input.meta.encrypted === false) { doc.delete('password'); doc.delete('passwordHint'); }
    // A changed date must not retain a timestamp from another calendar day.
    if (original.published !== input.meta.published) doc.delete('publishedAt');
    const text = '---\n'+doc.toString({lineWidth:0})+'---\n\n'+input.body.replace(/^\n+/, '');
    const result = this.transaction({[file]:text},exists?'保存文章：'+input.meta.title:'新建文章：'+input.meta.title);
    return {...this.readPost(input.id),backup:result.backup};
  }
  archivePost(id,revision) {
    const post = this.readPost(id);
    if (post.revision !== revision) throw new Error('文章已更新，请重新打开。');
    post.meta.draft = true;
    return this.savePost(post);
  }
  importMedia(buffer,name,kind) {
    const ext = path.extname(name).toLowerCase();
    const allowed = kind === 'audio' ? ['.mp3','.ogg','.wav','.m4a','.flac'] : ['.png','.jpg','.jpeg','.webp','.gif','.avif'];
    if (!allowed.includes(ext)) throw new Error('不支持的文件格式，请选择常见的图片或音频文件。');
    if (buffer.length > (kind === 'audio' ? 200 : 30)*1024*1024) throw new Error('图片不能超过 30 MB，音频不能超过 200 MB。');
    const relative = `public/manager-media/${kind}/${hash(buffer).slice(0,24)}${ext}`;
    const target = this.file(relative);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    if (!fs.existsSync(target)) fs.writeFileSync(target,buffer,{flag:'wx'});
    return '/'+relative.slice('public/'.length);
  }
  backups() {
    if (!fs.existsSync(this.backupRoot)) return [];
    return fs.readdirSync(this.backupRoot).sort().reverse().flatMap(id=> {
      try { return [JSON.parse(fs.readFileSync(path.join(this.backupRoot,id,'manifest.json'),'utf8'))]; } catch { return []; }
    });
  }
  restore(id) {
    if (!/^[\w.-]+$/.test(id)) throw new Error('备份编号无效。');
    const backup = this.backups().find(b=>b.id===id);
    if (!backup) throw new Error('找不到这个备份。');
    // New documents remain available as drafts; never silently delete user content.
    const updates = {};
    for (const entry of backup.entries) {
      this.file(entry.relative);
      if (entry.existed) updates[entry.relative] = fs.readFileSync(path.join(this.backupRoot,id,'files',entry.relative),'utf8');
      else if (entry.relative.startsWith('src/content/posts/') && fs.existsSync(this.file(entry.relative))) {
        const {doc,body}=parsePost(this.read(entry.relative)); doc.set('draft',true);
        updates[entry.relative]='---\n'+doc.toString()+'---\n'+body;
      }
    }
    return this.transaction(updates,'恢复备份：'+backup.label);
  }
}
module.exports = {Blog, parseTS, patchTS, literal, parsePost, hash};
