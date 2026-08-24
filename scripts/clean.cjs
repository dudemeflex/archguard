const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, 'dist');

if (path.dirname(outputDirectory) !== projectRoot) {
  throw new Error(`Refusing to clean unexpected path: ${outputDirectory}`);
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
