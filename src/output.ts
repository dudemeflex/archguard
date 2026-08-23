import fs from 'fs';
import path from 'path';

export function emitOutput(content: string, outputPath?: string, cwd = process.cwd()): void {
  if (outputPath) {
    fs.writeFileSync(path.resolve(cwd, outputPath), `${content}\n`, 'utf8');
    return;
  }
  console.log(content);
}
