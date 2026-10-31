const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
test('editor local image preview URLs round-trip to portable Markdown paths',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../ui/app.js'),'utf8');
  const helpers=source.slice(0,source.indexOf('function heading('));
  const context=vm.createContext({window:{blog:{}},document:{},URL,console});
  vm.runInContext(helpers+';globalThis.helpers={asset,bodyForView,bodyForSave,setPost:p=>post=p};',context);
  const h=context.helpers;h.setPost({id:'diary/test/index.md'});
  for(const image of ['./photo.jpg','../other.png','/manager-media/image/test.webp','https://example.com/a.png']){
    const markdown=`![图片](${image})`;
    const restored=h.bodyForSave(h.bodyForView(markdown));
    assert.equal(restored,markdown.replace('(./','('));
  }
  assert.equal(h.asset('assets/images/avatar.webp'),'blog-asset://src/assets/images/avatar.webp');
});
