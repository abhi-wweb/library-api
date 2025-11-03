const { Pool } = require("pg");
require("dotenv").config();

const isRender = process.env.DATABASE_URL?.includes("render.com");

const pool = new Pool(
  isRender
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {
        user: "postgres",
        host: "localhost",
        database: "notes",
        password: "abhi8767",
        port: 5432,
      }
);

pool
  .connect()
  .then(() => console.log("✅ Connected to PostgreSQL"))
  .catch((err) => console.error("❌ Database connection failed:", err.message));

module.exports = pool;
