import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import 'dotenv/config';

// package.json is the single source of truth for the version — of both this
// service and the WordPress plugin it ships (scripts/sync-version.sh keeps the
// plugin files in lockstep). The plugin update endpoint advertises this value.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

const config = {
  db: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    prefix: process.env.DB_PREFIX || 'wp_',
    charset: process.env.DB_CHARSET || 'utf8mb4',
    collate: process.env.DB_COLLATE || 'utf8mb4_unicode_ci',
  },
  port: parseInt(process.env.PORT, 10) || 3000,
  dataDir: resolve(process.env.DATA_DIR || '/data'),
  basePath: process.env.BASE_PATH || '',
  startupDelay: parseInt(process.env.STARTUP_DELAY, 10) || 0,
  // Bundled WordPress plugin, served for self-hosted auto-updates.
  pluginVersion: pkg.version,
  pluginZipPath: resolve(process.env.PLUGIN_ZIP_PATH || '/app/wordpress-idx-search.zip'),
  // Whether the plugin should install its updates automatically. Default true;
  // the chart exposes this as idx.pluginAutoUpdate and passes PLUGIN_AUTO_UPDATE.
  pluginAutoUpdate: process.env.PLUGIN_AUTO_UPDATE !== 'false',
};

export default config;
