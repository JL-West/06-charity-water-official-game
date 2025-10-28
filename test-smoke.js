const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

(async function(){
  const vcon = new VirtualConsole();
  vcon.on('log', msg => {/* ignore window logs */});
  vcon.on('error', msg => console.error('[window][error]', msg));

  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', virtualConsole: vcon });
  const { window } = dom;
  // wait for the page script to initialize
  await new Promise(res => window.addEventListener('load', res));

  const loadBtn = window.document.getElementById('loadBtn');
  const simple = window.document.getElementById('simpleLoader');
  const percent = window.document.getElementById('simpleLoaderPercent');

  console.log('loadBtn exists:', !!loadBtn);
  console.log('simpleLoader exists:', !!simple);

  if (!loadBtn || !simple) {
    console.error('Required elements not present; aborting smoke test.');
    process.exit(2);
  }

  // Trigger the load flow which calls showLoading internally
  loadBtn.click();

  // Wait long enough for the loader to complete (durationMs 300 + 220ms visible buffer)
  await new Promise(r => setTimeout(r, 900));

  const hidden = simple.classList.contains('hidden');
  const pct = percent ? percent.textContent : null;

  console.log('simpleLoader hidden after run:', hidden);
  console.log('simpleLoader percent text:', pct);

  if (hidden) {
    console.log('SMOKE TEST: PASS');
    process.exit(0);
  } else {
    console.error('SMOKE TEST: FAIL — loader still visible');
    process.exit(1);
  }
})();
