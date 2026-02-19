import { resolve } from 'node:path';
import 'dotenv/config';

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
};

export default config;
