// Native profile-form submits with delayed synthetic auth responses. No account writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(process.env.JKCREW_AUTH_SOURCE || path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Missing function: ' + name);
  const rest = source.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const markup = source.match(/<form id="password-form">[\s\S]*?<\/form>/)[0];
const messageRest = source.slice(source.indexOf('const messageFrom = '));
const messageFrom = messageRest.slice(0, messageRest.indexOf('\n};') + 3);
const fixture = `
const state = {user:{id:'fixture-account'},signingOut:false};
window.calls=[];window.notices=[];window.timeoutMs=15000;
window.defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
window.pending=defer();
const client={auth:{updateUser(body){calls.push(body);return pending.promise;}}};
const notify=(message,kind)=>notices.push({message,kind});
const withTimeout=(promise,label)=>testTimeout(promise,label,timeoutMs);
`;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  let checks = 0;
  const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const pages = [];
  async function fresh() {
    const page = await browser.newPage();
    pages.push(page);
    page.setDefaultTimeout(3000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><main id="fixture">' + markup + '</main>');
    await page.addScriptTag({ content: fixture + '\n' + messageFrom + '\n'
      + extract('withTimeout').replace('function withTimeout(', 'function testTimeout(') + '\n'
      + ['setButtonBusy', 'isTransientRequestError', 'authErrorMessage', 'updatePassword'].map(extract).join('\n')
      + '\ndocument.querySelector("#password-form").addEventListener("submit",updatePassword);' });
    await page.locator('#new-password').fill('synthetic-password-one');
    await page.locator('#confirm-password').fill('synthetic-password-one');
    return { page, errors };
  }
  const submit = page => page.locator('#password-form').evaluate(form => form.requestSubmit());
  async function settled(page) {
    await page.waitForFunction(() => !document.querySelector('#password-form')?.dataset.submitting);
  }
  async function restored(page) {
    equal(await page.locator('button').isEnabled(), true, 'Change password is available again');
    equal(await page.locator('button').textContent(), 'Change password', 'Original button label restored');
    equal(await page.locator('#password-form').getAttribute('aria-busy'), null, 'Busy state is removed');
  }
  async function retained(page, password = 'synthetic-password-one') {
    equal(await page.locator('#new-password').inputValue(), password, 'Password draft retained');
    equal(await page.locator('#confirm-password').inputValue(), password, 'Confirmation draft retained');
  }
  try {
    {
      const { page, errors } = await fresh();
      await submit(page);
      equal(await page.evaluate(() => calls.length), 1, 'Native submit starts one password update');
      equal(await page.locator('button').isDisabled(), true, 'Save is disabled while the delayed request runs');
      equal(await page.locator('#password-form').getAttribute('aria-busy'), 'true', 'Form announces pending request');
      await page.evaluate(() => pending.resolve({ error: null }));
      await settled(page);
      equal(await page.evaluate(() => notices), [{ message: 'Password changed.', kind: undefined }], 'Successful delayed update confirms completion');
      equal(await page.locator('#new-password').inputValue(), '', 'Successful update clears submitted password');
      equal(await page.locator('#confirm-password').inputValue(), '', 'Successful update clears confirmation');
      await restored(page);
      equal(errors, [], 'Native event currentTarget does not cause an exception after awaiting');
    }
    for (const outcome of ['returned', 'thrown']) {
      const { page, errors } = await fresh();
      await submit(page);
      await page.evaluate(outcome => outcome === 'returned'
        ? pending.resolve({ error: { message: 'Password update rejected' } })
        : pending.reject(new Error('Password update rejected')), outcome);
      await settled(page);
      equal(await page.evaluate(() => notices), [{ message: 'Password update rejected', kind: 'error' }], outcome + ' error is shown');
      await retained(page);
      await restored(page);
      equal(errors, [], outcome + ' error is handled');
    }
    {
      const { page, errors } = await fresh();
      await submit(page);
      await submit(page);
      equal(await page.evaluate(() => calls.length), 1, 'A second native submit cannot repeat a pending password update');
      await page.evaluate(() => pending.resolve({ error: null }));
      await settled(page);
      await restored(page);
      equal(errors, [], 'Repeated submit has no uncaught error');
    }
    {
      const { page, errors } = await fresh();
      await submit(page);
      await page.locator('#new-password').fill('newer-unsaved-password');
      await page.locator('#confirm-password').fill('newer-unsaved-password');
      await page.evaluate(() => pending.resolve({ error: null }));
      await settled(page);
      await retained(page, 'newer-unsaved-password');
      equal(await page.evaluate(() => calls[0].password), 'synthetic-password-one', 'Only the originally submitted password is sent');
      await restored(page);
      equal(errors, [], 'Editing a pending password preserves newer input');
    }
    for (const action of ['navigate', 'signout', 'switch-account', 'signout-pending']) {
      for (const outcome of ['success', 'error']) {
        const { page, errors } = await fresh();
        await submit(page);
        await page.evaluate(action => {
          window.oldForm = document.querySelector('#password-form');
          if (action === 'navigate') document.querySelector('#fixture').innerHTML = '<p id="destination">Another screen</p>';
          if (action === 'signout') state.user = null;
          if (action === 'switch-account') state.user = { id: 'another-account' };
          if (action === 'signout-pending') state.signingOut = true;
        }, action);
        await page.evaluate(outcome => pending.resolve(outcome === 'success'
          ? { error: null } : { error: { message: 'Late password error' } }), outcome);
        await page.waitForFunction(() => !oldForm.dataset.submitting);
        equal(await page.evaluate(() => notices), [], action + ' suppresses late ' + outcome + ' feedback');
        equal(await page.evaluate(() => oldForm.elements.password.value), 'synthetic-password-one', action + ' leaves old input untouched');
        equal(await page.evaluate(() => oldForm.querySelector('button').disabled), false, action + ' still releases the detached form lock');
        if (action === 'navigate') equal(await page.locator('#destination').textContent(), 'Another screen', 'Late save cannot replace the new screen');
        equal(errors, [], action + ' handles late ' + outcome + ' without exceptions');
      }
    }
    {
      const { page, errors } = await fresh();
      await page.evaluate(() => { timeoutMs = 30; });
      await submit(page);
      await settled(page);
      equal(await page.evaluate(() => calls.length), 1, 'Timeout never automatically retries a password change');
      equal(await page.evaluate(() => notices[0]?.kind), 'error', 'Timeout gives retryable feedback');
      await retained(page);
      await restored(page);
      await page.evaluate(async () => { pending.resolve({ error: null }); await new Promise(resolve => setTimeout(resolve, 10)); });
      equal(await page.evaluate(() => notices.length), 1, 'Late success cannot overwrite timeout feedback');
      await retained(page);
      equal(errors, [], 'Timeout and late completion are handled');
    }
    {
      const { page } = await fresh();
      await page.locator('#confirm-password').fill('different-password');
      await submit(page);
      equal(await page.evaluate(() => calls.length), 0, 'Mismatched passwords make no auth request');
      equal(await page.evaluate(() => notices), [{ message: 'Passwords do not match.', kind: 'error' }], 'Mismatch is shown');
      await restored(page);
    }
    console.log('PASS: ' + checks + ' native password-settings submit, delayed success, errors, duplicate prevention, drafts, timeout and navigation/account safety checks; no production traffic.');
  } finally {
    await Promise.all(pages.map(page => page.close()));
    await browser.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
