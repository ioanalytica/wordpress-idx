import mysql from 'mysql2/promise';
import config from './config.js';

export function createPool() {
  return mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: config.db.charset,
    waitForConnections: true,
    connectionLimit: 1,
  });
}

export async function testConnection() {
  const pool = createPool();
  try {
    const connection = await pool.getConnection();
    try {
      await connection.ping();
    } finally {
      connection.release();
    }
  } finally {
    await pool.end();
  }
}
