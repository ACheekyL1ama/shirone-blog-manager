const {contextBridge,ipcRenderer}=require('electron');
const channels=['info','choose-project','posts','read-post','save-post','archive-post','settings','save-settings','pick-media','import-image','preview','stop-preview','run-task','open-project','open-output','open-comments','backups','restore','dirty'];
const api={};
for(const channel of channels)api[channel.replace(/-([a-z])/g,(_,s)=>s.toUpperCase())]=async(...args)=>{const result=await ipcRenderer.invoke(channel,...args);if(!result.ok)throw new Error(result.error);return result.value;};
for(const channel of ['log','status','task-done'])api['on'+channel.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join('')]=callback=>{ipcRenderer.on(channel,(_event,data)=>callback(data));};
contextBridge.exposeInMainWorld('blog',api);
