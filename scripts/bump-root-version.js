const fs = require('fs');
const path = require('path');

const rootPkgPath = path.join(__dirname, '..', 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));

const [major, minor, patch] = rootPkg.version.split('.').map(Number);
rootPkg.version = `${major}.${minor}.${patch + 1}`;
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
console.log(`Root version bumped to ${rootPkg.version}`);
