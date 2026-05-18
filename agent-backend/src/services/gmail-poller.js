import { classifyEmails } from "./ai-classifier.js";
// Force nodemon restart to reload empty cache
import { filterEmails } from "./filter.js";
import { sendWhatsAppAlert } from "./whatsapp.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_FILE = path.join(__dirname, "../../processed-emails-backend.json");

let processedIds = new Set();
let pollInterval = null;
let googleAccessToken = null;

// Load cache from disk
try {
  if (fs.existsSync(CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    processedIds = new Set(data);
    console.log(`[Gmail Poller] Loaded ${processedIds.size} processed email IDs from cache.`);
  }
} catch (err) {
  console.error("[Gmail Poller] Error loading processed emails cache:", err.message);
}

// Save cache to disk
function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(Array.from(processedIds), null, 2), "utf8");
  } catch (err) {
    console.error("[Gmail Poller] Error saving processed emails cache:", err.message);
  }
}

/**
 * Save Google Access Token received from Extension and (re)start polling
 */
export function setAccessToken(token) {
  googleAccessToken = token;
  console.log("[Gmail Poller] New Google Access Token received! Starting background poller...");
  
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  
  // Run immediately once, then schedule every 30 seconds
  pollGmailInbox();
  pollInterval = setInterval(pollGmailInbox, 30000);
}

function extractEmailBody(payload) {
  if (!payload) return "";

  function decodeBase64(b64String) {
    try {
      const base64 = b64String.replace(/-/g, "+").replace(/_/g, "/");
      if (typeof Buffer !== "undefined") {
        return Buffer.from(base64, "base64").toString("utf8");
      } else {
        const rawData = atob(base64);
        return decodeURIComponent(escape(rawData));
      }
    } catch (e) {
      try {
        const base64 = b64String.replace(/-/g, "+").replace(/_/g, "/");
        if (typeof Buffer !== "undefined") {
          return Buffer.from(base64, "base64").toString("utf8");
        } else {
          return atob(base64);
        }
      } catch (err) {
        console.error("Failed to decode base64 email body:", err);
        return "";
      }
    }
  }

  // 1. Simple non-multipart email
  if (payload.body && payload.body.data) {
    return decodeBase64(payload.body.data);
  }

  // 2. Multipart email
  if (payload.parts && Array.isArray(payload.parts)) {
    let bodyText = "";
    
    // We prioritize text/plain, then fallback to text/html
    const plainPart = payload.parts.find((part) => part.mimeType === "text/plain");
    if (plainPart && plainPart.body && plainPart.body.data) {
      return decodeBase64(plainPart.body.data);
    }

    const htmlPart = payload.parts.find((part) => part.mimeType === "text/html");
    if (htmlPart && htmlPart.body && htmlPart.body.data) {
      const htmlText = decodeBase64(htmlPart.body.data);
      // Rough HTML tag stripping for clean AI readability
      return htmlText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }

    // Otherwise recurse nested parts
    for (const part of payload.parts) {
      bodyText = extractEmailBody(part);
      if (bodyText) return bodyText;
    }
  }

  return "";
}

/**
 * Main polling runner
 */
async function pollGmailInbox() {
  if (!googleAccessToken) {
    console.log("[Gmail Poller] No active Google Access Token. Waiting for connection...");
    return;
  }

  console.log(`[Gmail Poller] Checking Gmail inbox for new unread messages... (${new Date().toLocaleTimeString()})`);

  try {
    // 1. Fetch unread messages list from Gmail API
    // Querying with "?q=is:unread" ensures we only look at unread mails!
    const listResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=is:unread",
      {
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
        },
      }
    );

    if (!listResponse.ok) {
      if (listResponse.status === 401) {
        console.warn("[Gmail Poller] 🚨 Unauthorized (401). Access Token has expired! Please open the CareerPing AI extension to refresh connection.");
        stopPolling();
        return;
      }
      throw new Error(`Gmail API List error: ${listResponse.statusText}`);
    }

    const listData = await listResponse.json();
    const messages = listData.messages || [];
    
    if (messages.length === 0) {
      console.log("[Gmail Poller] No unread emails found.");
      return;
    }

    // Filter out messages that have already been processed
    const newMessages = messages.filter((msg) => !processedIds.has(msg.id));
    if (newMessages.length === 0) {
      console.log("[Gmail Poller] All unread emails have already been processed.");
      return;
    }

    console.log(`[Gmail Poller] Found ${newMessages.length} new unread emails. Fetching details...`);

    // 2. Fetch details for each message
    const emailPromises = newMessages.map(async (msg) => {
      try {
        const msgResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`,
          {
            headers: {
              Authorization: `Bearer ${googleAccessToken}`,
            },
          }
        );

        if (!msgResponse.ok) return null;
        const msgData = await msgResponse.json();

        const headers = msgData.payload?.headers || [];
        const fromHeader = headers.find((h) => h.name.toLowerCase() === "from")?.value || "Unknown";
        const subjectHeader = headers.find((h) => h.name.toLowerCase() === "subject")?.value || "(No Subject)";
        const dateHeader = headers.find((h) => h.name.toLowerCase() === "date")?.value || "";

        const labelIds = msgData.labelIds || [];
        const unread = labelIds.includes("UNREAD");

        const internalDate = msgData.internalDate;
        const timestamp = internalDate ? new Date(parseInt(internalDate)).toLocaleString() : dateHeader;

        return {
          id: msg.id,
          sender: fromHeader,
          subject: subjectHeader,
          snippet: msgData.snippet || "",
          body: extractEmailBody(msgData.payload),
          unread,
          time: timestamp,
        };
      } catch (err) {
        console.error(`[Gmail Poller] Error fetching details for message ${msg.id}:`, err.message);
        return null;
      }
    });

    const emailDetails = (await Promise.all(emailPromises)).filter(Boolean);
    if (emailDetails.length === 0) return;

    // 3. Heuristic / Rule Filter (Removes Obvious Noise)
    console.log(`[Gmail Poller] Pre-filtering ${emailDetails.length} emails through rules...`);
    const { passed, filtered } = filterEmails(emailDetails);

    // Add filtered emails directly to processed cache so we don't scan them again
    filtered.forEach((email) => {
      processedIds.add(email.id);
    });

    if (passed.length === 0) {
      console.log("[Gmail Poller] All new unread emails were filtered out as noise.");
      saveCache();
      return;
    }

    // 4. Gemini AI Classification
    console.log(`[Gmail Poller] Classifying ${passed.length} remaining emails with Gemini AI...`);
    const { results, errors } = await classifyEmails(passed);

    // Save ALL processed emails in cache
    passed.forEach((email) => processedIds.add(email.id));
    saveCache();

    // 5. Trigger WhatsApp alerts for important / actionable emails!
    for (const item of results) {
      const isActionable = item.classification && item.classification.actionable;
      if (isActionable) {
        console.log(`[Gmail Poller] 🚨 IMPORTANT Career opportunity detected! Sending WhatsApp alert: "${item.subject}"`);
        await sendWhatsAppAlert(item, item.classification);
      } else {
        console.log(`[Gmail Poller] ❌ Non-actionable: "${item.subject}"`);
      }
    }

  } catch (error) {
    console.error("[Gmail Poller] Error in periodic inbox check loop:", error.message);
  }
}

/**
 * Stop background poller
 */
export function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log("[Gmail Poller] Background polling stopped.");
  }
}
