// ----------------------
// 📦 Imports
// ----------------------
const express = require("express");
const cors = require("cors");
const pool = require("./db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");

// ----------------------
// ⚙️ Config
// ----------------------
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------
// 🗂️ Uploads Folder Setup
// ----------------------
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// ----------------------
// 🧠 Database Table Setup
// ----------------------
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS history (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      );
    `);
    console.log("✅ All tables ensured");
  } catch (err) {
    console.error("❌ Failed to ensure tables:", err.message);
  }
})();

// ----------------------
// 📂 FILE ROUTES
// ----------------------
app.get("/files", async (_, res) => {
  try {
    const result = await pool.query("SELECT * FROM files ORDER BY uploaded_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching files:", err.message);
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const result = await pool.query(
      "INSERT INTO files (name, url) VALUES ($1, $2) RETURNING *",
      [file.originalname, `/uploads/${file.filename}`]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error uploading file:", err.message);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

app.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const fileRes = await pool.query("SELECT * FROM files WHERE id=$1", [id]);

    if (fileRes.rows.length === 0)
      return res.status(404).json({ error: "File not found" });

    const filePath = path.join(__dirname, fileRes.rows[0].url.replace(/^\//, ""));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await pool.query("DELETE FROM files WHERE id=$1", [id]);
    res.json({ message: "File deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting file:", err.message);
    res.status(500).json({ error: "Failed to delete file" });
  }
});

// ----------------------
// 🔐 AUTH ROUTES
// ----------------------
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  try {
    const userExists = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    if (userExists.rows.length > 0)
      return res.status(400).json({ error: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email",
      [email, hashed]
    );

    const token = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET, {
      expiresIn: "2h",
    });
    res.json({ user: result.rows[0], token });
  } catch (err) {
    console.error("❌ Signup error:", err.message);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    if (result.rows.length === 0)
      return res.status(400).json({ error: "User not found" });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "2h" });
    res.json({ user: { id: user.id, email: user.email }, token });
  } catch (err) {
    console.error("❌ Login error:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
});

// ----------------------
// 🧠 AI ASK ROUTE
// ----------------------
app.post("/ask", async (req, res) => {
  const { question } = req.body;
  if (!question || !question.trim())
    return res.status(400).json({ error: "Question is required" });

  console.log("📩 Question:", question);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages: [
          { role: "system", content: "You are a helpful AI assistant." },
          { role: "user", content: question },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      console.error("❌ OpenRouter API Error:", await response.text());
      res.write(`data: ${JSON.stringify({ error: "Failed to fetch AI response" })}\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullAnswer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter((line) => line.trim() !== "");

      for (const line of lines) {
        if (line === "data: [DONE]") {
          res.write(`data: [DONE]\n\n`);
          res.end();

          pool
            .query("INSERT INTO history (question, answer) VALUES ($1, $2)", [
              question,
              fullAnswer.trim(),
            ])
            .catch((err) => console.error("❌ DB insert error:", err.message));

          return;
        }

        if (line.startsWith("data:")) {
          try {
            const data = JSON.parse(line.replace(/^data: /, ""));
            const token = data.choices?.[0]?.delta?.content || "";
            if (token) {
              fullAnswer += token;
              res.write(`data: ${JSON.stringify({ token })}\n\n`);
            }
          } catch (err) {
            console.error("❌ JSON parse error:", err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error("❌ Ask route error:", err.message);
    if (!res.headersSent)
      res.status(500).json({ error: "Failed to get AI response" });
  }
});

// ----------------------
// 🕓 CHAT HISTORY
// ----------------------
app.get("/history", async (_, res) => {
  try {
    const result = await pool.query(
      "SELECT question, answer, created_at FROM history ORDER BY created_at DESC LIMIT 20"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ History error:", err.message);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

app.delete("/history", async (_, res) => {
  try {
    await pool.query("DELETE FROM history");
    res.json({ message: "History cleared successfully" });
  } catch (err) {
    console.error("❌ Error clearing history:", err.message);
    res.status(500).json({ error: "Failed to clear history" });
  }
});

// ----------------------
// 🚀 SERVER START
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Server running on port ${PORT}`)
);
