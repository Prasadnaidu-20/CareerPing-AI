console.log("CareerPing AI Loaded ✅");

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailData {
  sender: string;
  subject: string;
  time: string;
  unread: boolean;
  snippet?: string;
}

// ─── DOM Scraper ──────────────────────────────────────────────────────────────

function scanEmails(): EmailData[] {
  const emails: EmailData[] = [];

  const rows = document.querySelectorAll("tr");

  rows.forEach((row) => {
    const senderElement = row.querySelector(".yP");
    const subjectElement = row.querySelector(".bog");
    const timeElement = row.querySelector(".xW span");

    if (senderElement && subjectElement && timeElement) {
      const sender = senderElement.textContent?.trim() || "";
      const subject = subjectElement.textContent?.trim() || "";
      const time = timeElement.textContent?.trim() || "";
      const unread = row.classList.contains("zE");

      // Extract snippet if present (.y2 contains the email snippet in Gmail)
      const snippetElement = row.querySelector(".y2");
      let snippet = snippetElement?.textContent?.trim() || "";

      // Clean up snippet if it starts with " - " or similar characters from subject separation
      if (snippet.startsWith("-")) {
        snippet = snippet.substring(1).trim();
      }

      // Skip empty entries
      if (!sender && !subject) return;

      emails.push({ sender, subject, time, unread, snippet });
    }
  });

  return emails;
}

// ─── Safe Message Sender ──────────────────────────────────────────────────────

function isExtensionContextValid(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
}

function sendEmailsToBackground(emails: EmailData[]): void {
  if (!isExtensionContextValid()) {
    console.warn("CareerPing: Extension context is not available or has been invalidated.");
    return;
  }
  try {
    chrome.runtime.sendMessage(
      { type: "EMAILS_DETECTED", payload: emails },
      (response) => {
        // Double check context validity inside the async callback
        if (!isExtensionContextValid()) {
          return;
        }
        // Suppress "no listener" error when background isn't ready
        if (chrome.runtime.lastError) {
          // Silently ignore — background may not be ready yet
          return;
        }
        if (response?.status === "ok") {
          console.log(
            `CareerPing: ${emails.length} emails sent, ${response.importantCount} flagged important`
          );
        }
      }
    );
  } catch (err) {
    console.warn("CareerPing: Failed to send message to background", err);
  }
}

// ─── Page Guard ───────────────────────────────────────────────────────────────

/**
 * Only scan when we're on the inbox list view, not inside a thread.
 * Gmail thread URLs contain "#" followed by a long ID, e.g. /#inbox/18f...
 * The inbox list is just /#inbox or /#all or /#search/...
 */
function isInboxListView(): boolean {
  const hash = window.location.hash;
  // Thread view has a hash segment with a long hex ID (>10 chars after the last slash)
  const parts = hash.split("/");
  const lastSegment = parts[parts.length - 1];
  return lastSegment.length < 15; // Thread IDs are typically 16+ hex chars
}

// ─── Scan Loop ────────────────────────────────────────────────────────────────

let lastPayloadHash = "";

function runScan(): void {
  if (!isInboxListView()) {
    console.log("Not in inbox list view, skipping scan");
    return;
  }

  const emails = scanEmails();

  if (emails.length === 0) {
    console.log("Scan returned 0 emails");
    return;
  }

  // Avoid sending duplicate payloads on every tick
  const currentHash = emails.map((e) => e.subject + e.sender).join("|");
  if (currentHash === lastPayloadHash) {
    console.log("Emails unchanged, skipping send");
    return;
  }

  lastPayloadHash = currentHash;
  sendEmailsToBackground(emails);
}

// ─── Wait for Gmail Inbox to Load ─────────────────────────────────────────────

function checkIfEmailsPresent(): boolean {
  // Check if the actual elements we scan for exist
  const hasEmailRows = document.querySelectorAll(".yP").length > 0;
  return hasEmailRows;
}

function waitForInboxLoad(): Promise<void> {
  return new Promise((resolve) => {
    console.log("Waiting for Gmail inbox to load...");

    // Check if email elements are already present
    if (checkIfEmailsPresent()) {
      console.log("✓ Emails already present on page");
      resolve();
      return;
    }

    // Otherwise, wait for them to appear
    let attempts = 0;
    const observer = new MutationObserver(() => {
      attempts++;
      if (checkIfEmailsPresent()) {
        console.log(`✓ Emails appeared after ${attempts} DOM mutations`);
        observer.disconnect();
        resolve();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Timeout after 15 seconds if nothing loads
    setTimeout(() => {
      observer.disconnect();
      console.warn(
        "⚠ CareerPing: Timeout waiting for emails. Proceeding anyway..."
      );
      console.log(
        "Debug: .yP elements found:",
        document.querySelectorAll(".yP").length
      );
      console.log(
        "Debug: .bog elements found:",
        document.querySelectorAll(".bog").length
      );
      console.log(
        "Debug: tr elements found:",
        document.querySelectorAll("tr").length
      );
      resolve();
    }, 15000);
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

waitForInboxLoad().then(() => {
  console.log("━━━ Gmail inbox ready — starting CareerPing scan ━━━");
  console.log("Current URL:", window.location.href);
  console.log("Current hash:", window.location.hash);

  // First scan with detailed logging
  const emails = scanEmails();
  console.log(`Initial scan found ${emails.length} emails`);

  if (emails.length > 0) {
    console.log("Sample email:", emails[0]);
    sendEmailsToBackground(emails);
  } else {
    console.warn("⚠ No emails detected. Diagnostics:");
    console.log("  → Is inbox list view?", isInboxListView());
    console.log("  → .yP count:", document.querySelectorAll(".yP").length);
    console.log("  → .bog count:", document.querySelectorAll(".bog").length);
    console.log("  → tr count:", document.querySelectorAll("tr").length);
  }

  // Then start periodic scanning
  setInterval(runScan, 6000);
});