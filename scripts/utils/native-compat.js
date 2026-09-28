const { execFileSync } = require('child_process');

// Newest symbol versions a bundled native addon may depend on. The AppImage
// uses the system glibc and libstdc++, and the other native addons already
// need glibc 2.34, so this keeps the floor at Ubuntu 22.04 / RHEL 9 / Debian 12.
const MAX_VERSIONS = {
  GLIBC: '2.34',
  GLIBCXX: '3.4.29',
  CXXABI: '1.3.13'
};

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Dynamic symbols whose version is newer than allowed, e.g. ['fmod@GLIBC_2.38'].
function symbolsTooNew(file, max = MAX_VERSIONS) {
  const out = execFileSync('objdump', ['-T', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const tooNew = [];
  for (const line of out.split('\n')) {
    const m = line.match(/\(?(GLIBCXX|CXXABI|GLIBC)_(\d+(?:\.\d+)+)\)?\s+(\S+)\s*$/);
    if (m && max[m[1]] && compareVersions(m[2], max[m[1]]) > 0) {
      tooNew.push(`${m[3]}@${m[1]}_${m[2]}`);
    }
  }
  return tooNew;
}

module.exports = { MAX_VERSIONS, compareVersions, symbolsTooNew };
