const mongoose = require("mongoose");

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log("✔ connected");
    await mongoose.connection.db.admin().ping();
    console.log("✔ ping ok");
    process.exit(0);
  } catch (e) {
    console.error("X connect failed:", e);
    process.exit(1);
  }
})();


