// node check-scheduler.cjs：用实际 bundle 内的 JSZip 复现隔离环境的消息来源差异。
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const bundle = fs.readFileSync(`${__dirname}/dom-to-pptx.bundle.js`, 'utf8');
const start = bundle.indexOf('function requireJszip_min ()');
const end = bundle.indexOf('var jszip_minExports', start);
assert.ok(start > 0 && end > start);
const jszipCode = bundle.slice(start, end);
const pageWindow = {};
const listeners = [];
const sandbox = {
  setTimeout, clearTimeout, console, Promise, Blob,
  postMessage(data) {
    setTimeout(() => listeners.forEach(fn => fn({ data, source: pageWindow })), 0);
  },
  addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
};
sandbox.self = sandbox;
const context = vm.createContext(sandbox);
vm.runInContext(`var jszip_min = {exports:{}}; var hasRequiredJszip_min; ${jszipCode}
  var JSZip = requireJszip_min();
  var zip = new JSZip(); zip.file('test.txt', 'hello');
  var pendingZip = zip.generateAsync({type:'uint8array'});`, context);

(async () => {
  let completed = false;
  context.pendingZip.then(() => { completed = true; });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(completed, false, '消息 source 不同，原始调度器应无法完成');
  // 与用户脚本共享同样的调度修复代码。
  const userScript = fs.readFileSync(`${__dirname}/chatgpt-card-export.user.js`, 'utf8');
  const fix = userScript.slice(userScript.indexOf('// BEGIN sandbox scheduler'), userScript.indexOf('// END sandbox scheduler'));
  assert.ok(fix.includes('var setImmediate'));
  vm.runInContext(fix, context);
  const result = await Promise.race([
    vm.runInContext(`new JSZip().file('test.txt', 'hello').generateAsync({type:'uint8array'})`, context),
    new Promise((_, reject) => setTimeout(() => reject(new Error('修复后仍然超时')), 1000)),
  ]);
  assert.ok(result.length > 100);
  const fontCode = userScript.slice(userScript.indexOf('// BEGIN output font'), userScript.indexOf('// END output font'));
  vm.runInContext(fontCode, context);
  const output = await vm.runInContext(`(async () => {
    var input = new JSZip();
    input.file('ppt/slides/slide1.xml', '<a:rPr><a:latin typeface="Arial"/><a:ea typeface="SimSun"/></a:rPr>');
    input.file('ppt/theme/theme1.xml', '<a:latin typeface="Aptos"/><a:ea typeface=""/>');
    input.file('ppt/media/image1.png', new Uint8Array([1,2,3]));
    var blob = await input.generateAsync({type:'blob'});
    var fixed = await forcePptxFont(blob);
    var zip = await JSZip.loadAsync(new Uint8Array(await fixed.arrayBuffer()));
    return {
      slide: await zip.file('ppt/slides/slide1.xml').async('string'),
      theme: await zip.file('ppt/theme/theme1.xml').async('string'),
      image: Array.from(await zip.file('ppt/media/image1.png').async('uint8array')),
    };
  })()`, context);
  assert.equal((output.slide.match(/Microsoft YaHei UI/g) || []).length, 2);
  assert.equal((output.theme.match(/Microsoft YaHei UI/g) || []).length, 2);
  assert.deepEqual(Array.from(output.image), [1,2,3]);
  console.log('PASS: 实际 JSZip 复现消息调度挂起；修复后成功生成 ZIP');
  console.log('PASS: PPT 文字及主题字体统一，图片内容保持不变');
})().catch(error => { console.error(error); process.exitCode = 1; });
