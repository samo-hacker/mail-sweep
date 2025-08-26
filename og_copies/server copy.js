// server.js
import express from "express";
import { google } from "googleapis";
import dotenv from "dotenv";
import session from "cookie-session";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();
const PORT = 3000;

// Session
app.use(
  session({
    name: "session",
    keys: [process.env.SESSION_SECRET || "supersecret"],
  })
);

// OAuth2 Client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/auth/callback"
);

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

// Serve the front-end HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Login route
app.get("/auth", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  res.redirect(url);
});

// Callback route
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  req.session.tokens = tokens;
  res.send("Login successful! Go to /emails to see your emails.");
});

// Fetch emails route
app.get("/emails", async (req, res) => {
  if (!req.session.tokens) return res.redirect("/auth");

  oauth2Client.setCredentials(req.session.tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  // Get promo emails
  const response = await gmail.users.messages.list({
    userId: "me",
    q: "category:promotions",
    maxResults: 10,
  });

  const messages = response.data.messages || [];
  const emailDetails = [];

  for (let msg of messages) {
    const fullMsg = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
    });

    const headers = fullMsg.data.payload.headers;
    const subject =
      headers.find((h) => h.name === "Subject")?.value || "(no subject)";
    const from =
      headers.find((h) => h.name === "From")?.value || "(unknown)";
    const unsubscribe =
      headers.find((h) => h.name === "List-Unsubscribe")?.value || null;

    emailDetails.push({ subject, from, unsubscribe });
  }

  res.json(emailDetails);
});

// Start server
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
