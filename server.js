const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Main API route
app.get("/", (req, res) => {
  res.json({
    message: "Event Registration API is running 🚀",
  });
});

// API health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "event-registration-api",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});