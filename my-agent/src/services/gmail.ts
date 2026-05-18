export async function getProfile(token: string) {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await response.json();
  return data;
}

export interface EmailDetails {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  body: string;
  unread: boolean;
  time: string;
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

export async function fetchEmails(token: string, maxResults: number = 10): Promise<EmailDetails[]> {
  const listResponse = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!listResponse.ok) {
    throw new Error(`Failed to fetch message list: ${listResponse.statusText}`);
  }

  const listData = (await listResponse.json()) as { messages?: { id: string }[] };
  const messages = listData.messages || [];

  if (messages.length === 0) {
    return [];
  }

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

      if (!msgResponse.ok) {
        return null;
      }

      const msgData = await msgResponse.json();

      // Extract headers
      const headers = msgData.payload?.headers || [];
      const fromHeader = headers.find((h: any) => h.name.toLowerCase() === "from")?.value || "Unknown";
      const subjectHeader = headers.find((h: any) => h.name.toLowerCase() === "subject")?.value || "(No Subject)";
      const dateHeader = headers.find((h: any) => h.name.toLowerCase() === "date")?.value || "";

      // Check if unread (labelIds contains "UNREAD")
      const labelIds = msgData.labelIds || [];
      const unread = labelIds.includes("UNREAD");

      // Format Timestamp from epoch millisecond
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
      console.error(`Error fetching message ${msg.id}:`, err);
      return null;
    }
  });

  const results = await Promise.all(emailPromises);
  return results.filter((email): email is EmailDetails => email !== null);
}

export interface BackendClassification {
  actionable: boolean;
  category: string;
  urgency: "high" | "medium" | "low";
  deadline: string | null;
  confidence: number;
  reason: string;
  keyInfo: string;
}

export interface ClassifiedEmail extends EmailDetails {
  filtered: boolean;
  classification: BackendClassification;
}

export interface BackendResponse {
  success: boolean;
  stats: {
    total: number;
    actionable: number;
    nonActionable: number;
    filtered: number;
    errors: number;
  };
  results: ClassifiedEmail[];
}

export async function classifyEmailsWithBackend(emails: EmailDetails[]): Promise<BackendResponse> {
  const response = await fetch("http://localhost:5000/api/classify/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ emails }),
  });

  if (!response.ok) {
    throw new Error(`Backend classification request failed: ${response.statusText}`);
  }

  const data = (await response.json()) as BackendResponse;
  return data;
}

export async function saveTokenToBackend(token: string): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:5000/api/classify/save-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });
    return response.ok;
  } catch (err) {
    console.error("Failed to save token to backend:", err);
    return false;
  }
}