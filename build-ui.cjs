const esbuild=require('esbuild');
const path=require('node:path');
esbuild.buildSync({entryPoints:[path.join(__dirname,'ui/editor-entry.js')],outfile:path.join(__dirname,'ui/vendor/editor.js'),bundle:true,format:'iife',platform:'browser',minify:true,legalComments:'eof'});
console.log('Editor browser bundle built.');
