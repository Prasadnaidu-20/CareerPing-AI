console.log("CareerPing AI — Background Service Running ✅");

// ─── Startup Configuration ───────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Clear any existing alarms to prevent double triggering
  chrome.alarms.clearAll(() => {
    // Schedule check every 5 minutes
    chrome.alarms.create("check-gmail-alarm", {
      delayInMinutes: 1, // First run after 1 minute
      periodInMinutes: 5, // Repeat every 5 minutes
    });
    console.log("CareerPing: Background periodic checker scheduled (5 min interval).");
  });
});

// ─── Listen for Background Alarms ────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "check-gmail-alarm") {
    console.log("CareerPing: Periodic alarm triggered. Scanning Gmail inbox...");
    await runSilentGmailScan();
  }
});

// ─── Native Notification Click Handler ────────────────────────────────────────

chrome.notifications.onClicked.addListener((notificationId) => {
  // Open Gmail inbox when notification is clicked
  chrome.tabs.create({ url: "https://mail.google.com" });
  chrome.notifications.clear(notificationId);
});

// ─── Core Background Worker ──────────────────────────────────────────────────

/**
 * Wake up, silently authenticate, fetch Gmail, classify, and notify user
 */
async function runSilentGmailScan() {
  try {
    // 1. Get a silent OAuth access token (no interactive UI popup)
    const token = await getSilentAuthToken();
    if (!token) {
      console.log("CareerPing: Silent login skipped (user has not connected/authorized yet).");
      return;
    }

    // Proactively sync token with Express backend for 30-sec polling and WhatsAppalerts
    try {
      await fetch("http://localhost:5000/api/classify/save-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch (err) {
      console.error("CareerPing background: Failed to sync token with backend:", err);
    }

    // 2. Fetch the 10 most recent emails from Gmail API
    console.log("CareerPing background: Fetching recent emails...");
    const emails = await silentFetchRecentEmails(token, 10);
    if (emails.length === 0) {
      console.log("CareerPing background: No emails fetched.");
      return;
    }

    // 3. Deduplicate using persistent processedIds in storage
    const storageData = await chrome.storage.local.get({ processedIds: [] }) as { processedIds: string[] };
    const processedSet = new Set(storageData.processedIds);

    const newEmails = emails.filter((email) => !processedSet.has(email.id));
    if (newEmails.length === 0) {
      console.log("CareerPing background: All fetched emails already processed. Skipping.");
      return;
    }

    // 4. Mark immediately as processed to protect API quota in case of subsequent failures
    newEmails.forEach((email) => processedSet.add(email.id));
    await chrome.storage.local.set({ processedIds: Array.from(processedSet) });

    console.log(`CareerPing background: Found ${newEmails.length} NEW emails. Sending to backend...`);

    // 5. Send to Express backend for Gemini AI classification
    const backendResponse = await fetch("http://localhost:5000/api/classify/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ emails: newEmails }),
    });

    if (!backendResponse.ok) {
      throw new Error(`Classification backend returned status: ${backendResponse.statusText}`);
    }

    const data = await backendResponse.json();
    if (!data.success) {
      throw new Error("Backend classification reports unsuccessful state.");
    }

    console.log(
      `CareerPing background: Classified ${data.results.length} results | ` +
      `${data.stats.actionable} actionable | ${data.stats.filtered} filtered`
    );

    // 6. Notify user of new actionable items and store them
    const notifiedData = await chrome.storage.local.get({ notifiedIds: [] }) as { notifiedIds: string[] };
    const notifiedSet = new Set(notifiedData.notifiedIds);

    for (const item of data.results) {
      const isActionable = item.classification && item.classification.actionable;
      
      if (isActionable && !notifiedSet.has(item.id)) {
        notifiedSet.add(item.id);

        // Store inside importantEmails
        const importantData = await chrome.storage.local.get({ importantEmails: [] }) as { importantEmails: any[] };
        const storedItem = {
          id: item.id,
          sender: item.sender,
          subject: item.subject,
          snippet: item.snippet,
          unread: item.unread,
          time: item.time,
          classification: item.classification,
          detectedAt: Date.now(),
        };

        await chrome.storage.local.set({
          importantEmails: [storedItem, ...importantData.importantEmails].slice(0, 100),
          notifiedIds: Array.from(notifiedSet),
        });

        // Trigger Windows / System Notification
        const urgencyIcon = item.classification.urgency === "high" ? "🚨" : "📬";
        const categoryName = item.classification.category.toUpperCase();

        chrome.notifications.create(item.id, {
          type: "basic",
          iconUrl: "icon.png",
          title: `${urgencyIcon} CareerPing AI [${categoryName}]`,
          message: item.subject,
          contextMessage: `${item.classification.reason} | Info: ${item.classification.keyInfo}`,
          priority: item.classification.urgency === "high" ? 2 : 1,
        });

        console.log(`CareerPing background: Alerted user about actionable email: "${item.subject}"`);
      }
    }
  } catch (error: any) {
    console.error("CareerPing background: Error in background Gmail check:", error);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Authenticate silently using chrome.identity
 */
function getSilentAuthToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token: any) => {
      if (chrome.runtime.lastError || !token) {
        resolve(null);
      } else {
        const parsedToken = typeof token === "string" ? token : token.token;
        resolve(parsedToken || null);
      }
    });
  });
}

function extractEmailBody(payload: any): string {
  if (!payload) return "";

  function decodeBase64(b64String: string) {
    try {
      const base64 = b64String.replace(/-/g, "+").replace(/_/g, "/");
      const rawData = atob(base64);
      return decodeURIComponent(escape(rawData));
    } catch (e) {
      try {
        const base64 = b64String.replace(/-/g, "+").replace(/_/g, "/");
        return atob(base64);
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
    const plainPart = payload.parts.find((part: any) => part.mimeType === "text/plain");
    if (plainPart && plainPart.body && plainPart.body.data) {
      return decodeBase64(plainPart.body.data);
    }

    const htmlPart = payload.parts.find((part: any) => part.mimeType === "text/html");
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
 * Fetch and extract email details from Google Gmail API
 */
async function silentFetchRecentEmails(token: string, maxResults: number) {
  try {
    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!listResponse.ok) return [];

    const listData = (await listResponse.json()) as { messages?: { id: string }[] };
    const messages = listData.messages || [];

    if (messages.length === 0) return [];

    const emailPromises = messages.map(async (msg) => {
      try {
        const msgResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!msgResponse.ok) return null;

        const msgData = await msgResponse.json();

        // Extract headers
        const headers = msgData.payload?.headers || [];
        const fromHeader = headers.find((h: any) => h.name.toLowerCase() === "from")?.value || "Unknown";
        const subjectHeader = headers.find((h: any) => h.name.toLowerCase() === "subject")?.value || "(No Subject)";
        const dateHeader = headers.find((h: any) => h.name.toLowerCase() === "date")?.value || "";

        // Check if unread
        const labelIds = msgData.labelIds || [];
        const unread = labelIds.includes("UNREAD");

        // Timestamp
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
        return null;
      }
    });

    const results = await Promise.all(emailPromises);
    return results.filter((email): email is any => email !== null);
  } catch (err) {
    console.error("Silent Fetch Error:", err);
    return [];
  }
}