const { execFileSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const { symbolsTooNew } = require('../utils/native-compat');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

const ROOT_DIR = path.join(__dirname, '..', '..');
const APP_DIR = path.join(ROOT_DIR, 'app');
const NODE_MODULES = path.join(ROOT_DIR, 'node_modules');

// Old glibc (2.31) and GCC (10) toolchain, so the result only depends on old
// glibc/libstdc++ symbol versions and loads on every supported distro.
const BUILD_IMAGE = 'node:20-bullseye';

function hasDocker() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function run(command, args, options) {
  try {
    execFileSync(command, args, { stdio: 'pipe', ...options });
  } catch (error) {
    logger.error(String(error.stdout || '') + String(error.stderr || ''));
    throw new Error(`Failed to rebuild sqlite3 from source (${command})`);
  }
}

// The prebuilt binary npm downloads is built on a recent distro: it needs
// fmod@GLIBC_2.38 and GLIBCXX_3.4.31, so Zalo's database never loads on
// Ubuntu 22.04 / Debian 12 and message sync hangs. Rebuild the same sqlite3
// version from source, inside an old-toolchain container when possible.
function rebuildFromSource() {
  if (hasDocker()) {
    logger.info(`Rebuilding sqlite3 from source in ${BUILD_IMAGE}...`);
    run('docker', [
      'run', '--rm',
      '-u', `${process.getuid()}:${process.getgid()}`,
      '-e', 'HOME=/tmp',
      '-v', `${NODE_MODULES}:/w/node_modules`,
      '-w', '/w/node_modules/sqlite3',
      BUILD_IMAGE,
      'npm', 'rebuild', '--build-from-source'
    ]);
  } else {
    logger.warn('Docker not available, rebuilding sqlite3 with the host toolchain');
    run('npm', ['rebuild', 'sqlite3', '--build-from-source'], { cwd: ROOT_DIR });
  }
}

async function main() {
  const sqliteTargetDir = path.join(APP_DIR, 'native', 'nativelibs', 'sqlite3', 'binding', `napi-v6-linux-${arch}`);
  fs.mkdirSync(sqliteTargetDir, { recursive: true });

  const targetNodePath = path.join(sqliteTargetDir, 'node_sqlite3.node');
  const sourceNodePath = path.join(NODE_MODULES, 'sqlite3', 'build', 'Release', 'node_sqlite3.node');

  if (!fs.existsSync(sourceNodePath)) {
    logger.warn('SQLite3 binary not found in node_modules. Run "npm install" first.');
    return;
  }

  if (symbolsTooNew(sourceNodePath).length > 0) {
    rebuildFromSource();
  }

  const tooNew = symbolsTooNew(sourceNodePath);
  if (tooNew.length > 0) {
    throw new Error(
      `node_sqlite3.node would not load on older distros, it needs: ${tooNew.join(', ')}. ` +
      `Install Docker so it can be built in ${BUILD_IMAGE}.`
    );
  }

  fs.copyFileSync(sourceNodePath, targetNodePath);
  logger.dim('SQLite3 Linux binary installed from node_modules');
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('SQLite3 patch failed:', error.message);
    process.exit(1);
  });
}

module.exports = { main };
