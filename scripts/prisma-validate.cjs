const { spawnSync } = require('node:child_process');

const path = require('node:path');
const prismaCli = path.join(
  path.dirname(require.resolve('prisma/package.json')),
  'build',
  'index.js',
);
const result = spawnSync(process.execPath, [prismaCli, 'validate'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ||
      'postgresql://schema:validation@127.0.0.1:5432/schema_validation',
  },
});

process.exit(result.status ?? 1);
