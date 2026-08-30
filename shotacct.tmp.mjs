import { chromium } from 'playwright';
const dir = '/tmp/claude-1000/-home-jdc308-afct/a2d16942-3578-4208-ac2e-ef735d5b5731/scratchpad';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1100 } });
await p.goto('http://localhost:3000/login');
await p.getByLabel('Email', { exact: true }).fill('faculty@example.com');
await p.getByLabel('Password', { exact: true }).fill('password123');
await p.click('button[type="submit"]');
await p.waitForURL('**/dashboard**', { timeout: 30000 });
for (const tab of ['profile', 'password', 'accounts', 'tokens']) {
  await p.goto(`http://localhost:3000/dashboard/account?tab=${tab}`);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${dir}/acct-${tab}.png`, fullPage: true });
}
await b.close();
console.log('done');
