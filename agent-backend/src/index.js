const express = require("express");
const cors = require("cors");
const config = require("./config");

require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("CareerPing Backend Running");
});

// Routes
const classifyRoute = require("./routes/classify");
app.use("/api/classify", classifyRoute);

const PORT = config.port;

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});