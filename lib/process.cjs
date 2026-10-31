const {spawn}=require('node:child_process');
// Arguments are fixed application commands, or a validated pnpm version; never user prose.
function launchNpm(root,args) {
  return spawn('cmd.exe',['/d','/s','/c',`npm.cmd ${args}`],{
    cwd:root,windowsHide:true,env:{...process.env,ASTRO_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
  });
}
module.exports={launchNpm};
