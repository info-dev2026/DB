/* ============================================================
   scripts/auto-sync.js
   Automatically watch for code changes, commit, and push to:
   https://github.com/info-dev2026/DB
   ============================================================ */

const { execSync } = require('child_process');
const path = require('path');

const repoDir = path.resolve(__dirname, '..');

function getGitStatus() {
  try {
    const status = execSync('git status --porcelain', { cwd: repoDir, encoding: 'utf8' }).trim();
    return status;
  } catch (err) {
    return '';
  }
}

function sync() {
  const status = getGitStatus();
  if (!status) return false;

  const lines = status.split('\n').filter(Boolean);
  const fileNames = lines.map((l) => l.slice(3).trim()).slice(0, 3).join(', ');
  const more = lines.length > 3 ? ` (+${lines.length - 3} more)` : '';
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const msg = `auto-sync: ${fileNames}${more} [${now}]`;

  console.log(`[${new Date().toLocaleTimeString()}] 📦 Detected changes:`);
  console.log(status);
  console.log(`[${new Date().toLocaleTimeString()}] 🔄 Staging & committing...`);

  try {
    execSync('git add -A', { cwd: repoDir, stdio: 'inherit' });
    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: repoDir, stdio: 'inherit' });
    console.log(`[${new Date().toLocaleTimeString()}] 🚀 Pushing to https://github.com/info-dev2026/DB (main & master)...`);
    execSync('git push origin main', { cwd: repoDir, stdio: 'inherit' });
    try {
      execSync('git push origin main:master', { cwd: repoDir, stdio: 'inherit' });
    } catch (masterErr) {
      console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ Push to master branch skipped/failed:`, masterErr.message);
    }
    console.log(`[${new Date().toLocaleTimeString()}] ✅ Successfully synced to GitHub!\n`);
    return true;
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] ⚠️ Sync failed:`, err.message);
    return false;
  }
}

if (process.argv.includes('--once')) {
  const synced = sync();
  if (!synced) console.log('No changes to sync. Everything is up to date.');
  process.exit(0);
}

console.log('============================================================');
console.log('  👀 Auto-sync watcher active for GitHub repo:');
console.log('  https://github.com/info-dev2026/DB');
console.log('  Any edits you make will automatically be pushed.');
console.log('============================================================\n');

// Check every 10 seconds
setInterval(() => {
  sync();
}, 10000);
