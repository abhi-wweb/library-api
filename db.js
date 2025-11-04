const { Pool } = require('pg');
require('dotenv').config();

const isRender = process.env.RENDER === 'true' || process.env.DATABASE_URL?.includes('render.com');

const pool = new Pool(
  isRender
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false, // important for Render SSL
        },
      }
    : {
        user: 'postgres',
        host: 'localhost',
        database: 'notes',
        password: 'abhi8767',
        port: 5432,
      }
);

module.exports = pool;
