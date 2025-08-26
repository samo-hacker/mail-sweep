import express from "express";
import { google } from "googleapis";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Buffer } from "buffer";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static("public"));

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

app.get("/", (req, res) => {
  if (app.locals.tokens) {
    res.redirect("/emails");
  } else {
    res.send('<a href="/auth">Login with Google</a>');
  }
});

app.get("/auth", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  });
  res.redirect(url);
});

app.get("/auth/callback", async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    app.locals.tokens = tokens;
    res.redirect("/emails");
  } catch (err) {
    console.error("Auth callback error:", err);
    res.status(500).send("Authentication failed.");
  }
});

app.get("/logout", (req, res) => {
  app.locals.tokens = null;
  res.redirect("/");
});

app.get("/emails", (req, res) => {
  if (!app.locals.tokens) return res.redirect("/auth");
  res.sendFile(path.join(__dirname, "public/index.html"));
});

function decodeBase64(str) {
  return Buffer.from(str, "base64").toString("utf-8");
}

// ✅ Fetch only Promotions emails and include unsubscribe info
app.get("/api/emails", async (req, res) => {
  try {
    if (!app.locals.tokens) return res.status(401).json({ error: "Not authenticated" });

    oauth2Client.setCredentials(app.locals.tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const result = await gmail.users.messages.list({
      userId: "me",
      maxResults: 50, // fetch more if needed
      q: "category:promotions",
    });

    const messages = result.data.messages || [];
    const emails = [];

    for (const msg of messages) {
      const msgData = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
      });

      const headers = msgData.data.payload.headers || [];
      const subject = headers.find(h => h.name === "Subject")?.value || "(No subject)";
      const from = headers.find(h => h.name === "From")?.value || "(Unknown sender)";

      // Check unsubscribe headers
      let unsubscribe =
        headers.find(h => h.name && h.name.toLowerCase() === "list-unsubscribe")?.value ||
        headers.find(h => h.name && h.name.toLowerCase() === "list-unsubscribe-post")?.value ||
        null;

      // Scan HTML body if no header found
      if (!unsubscribe && msgData.data.payload.parts) {
        for (const part of msgData.data.payload.parts) {
          if (part.mimeType === "text/html" && part.body?.data) {
            const html = decodeBase64(part.body.data);
            const match = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>(?:[^<]*unsubscribe[^<]*)<\/a>/i);
            if (match) {
              unsubscribe = match[1];
              break;
            }
          }
        }
      }

      emails.push({ subject, from, unsubscribe });
    }

    res.json(emails);
  } catch (err) {
    console.error("Error fetching emails:", err);
    res.status(500).send("Error fetching emails");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
