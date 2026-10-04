import fs from 'node:fs';
import path from 'node:path';

const outDir = 'dist';
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

for (const file of ['game.json', 'cover.png']) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(outDir, file));
  }
}
