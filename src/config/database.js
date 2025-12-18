const mongoose = require("mongoose");

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("MONGODB_URI não definida na Vercel (Production)");

let cached = global.__mongoose;
if (!cached) cached = global.__mongoose = { conn: null, promise: null };

async function connectDatabase() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 30000,
      bufferCommands: false,
    });
  }

  cached.conn = await cached.promise;
  console.log("✅ Connected to MongoDB");
  return cached.conn;
}

module.exports = { connectDatabase };