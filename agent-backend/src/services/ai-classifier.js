import logger from "../utils/logger.js";
import {
  buildClassificationPrompt,
  validateClassificationResponse,
  getSystemPromptWithExamples,
} from "../utils/prompt-templates.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-2.0-flash";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sleep utility for retry backoff
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get API key from environment (loaded via dotenv in config)
 */
function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to your .env file."
    );
  }
  return key;
}

/**
 * Extract JSON from AI response text (handles markdown code blocks, etc.)
 */
function extractJSON(text) {
  // Try direct parse first
  try {
    return JSON.parse(text.trim());
  } catch {
    // Not valid JSON directly
  }

  // Try extracting from markdown code block ```json ... ```
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue to next strategy
    }
  }

  // Try extracting first { ... } block
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0].trim());
    } catch {
      // Could not parse
    }
  }

  throw new Error(`Failed to extract valid JSON from AI response: ${text.substring(0, 200)}`);
}

// ─── Gemini API Call ──────────────────────────────────────────────────────────

/**
 * Call Gemini API with the classification prompt
 * Uses the REST API directly (no SDK dependency needed)
 */
async function callGeminiAPI(email) {
  const apiKey = getApiKey();
  const systemPrompt = getSystemPromptWithExamples();
  const userPrompt = buildClassificationPrompt(email);

  const url = `${GEMINI_API_URL}/${MODEL}:generateContent?key=${apiKey}`;

  const requestBody = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2, // Low temp for consistent classification
      maxOutputTokens: 512,
      responseMimeType: "application/json",
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Gemini API error (${response.status}): ${errorBody.substring(0, 300)}`
    );
  }

  const data = await response.json();

  // Extract text from Gemini response structure
  const candidates = data.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("Gemini returned no candidates");
  }

  const content = candidates[0]?.content;
  if (!content || !content.parts || content.parts.length === 0) {
    throw new Error("Gemini returned empty content");
  }

  return content.parts[0].text;
}

// ─── Core Classification ─────────────────────────────────────────────────────

/**
 * Classify a single email using Gemini AI
 *
 * @param {Object} email - Email object with { sender, subject, snippet, body? }
 * @returns {Object} Classification result with actionable, category, urgency, etc.
 */
export async function classifyEmail(email) {
  const startTime = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.debug(
        `🤖 Classifying email (attempt ${attempt}/${MAX_RETRIES}): "${email.subject}"`
      );

      // Call Gemini API
      const rawResponse = await callGeminiAPI(email);

      // Parse JSON from response
      const classification = extractJSON(rawResponse);

      // Validate the response structure
      validateClassificationResponse(classification);

      // Add metadata
      classification.processedAt = new Date().toISOString();
      classification.processingTimeMs = Date.now() - startTime;
      classification.model = MODEL;

      // Log the result
      logger.classify(email.subject, classification);

      return classification;
    } catch (error) {
      logger.warn(
        `Attempt ${attempt}/${MAX_RETRIES} failed for "${email.subject}": ${error.message}`
      );

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt; // Exponential-ish backoff
        logger.debug(`Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        logger.error(
          `All ${MAX_RETRIES} attempts failed for "${email.subject}"`
        );
        throw error;
      }
    }
  }
}

/**
 * Call Gemini API with multiple emails in a single prompt
 * Uses REST API directly and asks for a JSON array response
 */
async function callGeminiAPIBatch(emails) {
  const apiKey = getApiKey();

  const systemPrompt = `You are an intelligent email classifier for CareerPing, a career opportunity detection system.

Your job is to analyze a list of emails and determine if each email represents an ACTIONABLE career opportunity that requires immediate attention from a job seeker.

ACTIONABLE emails include:
- Interview invitations or scheduling requests
- Assessment/test links or coding challenges
- Application status updates (shortlisted, selected, rejected with feedback)
- Offer letters or compensation discussions
- Onboarding instructions or joining date confirmations
- Direct recruiter outreach with specific roles
- Deadline-sensitive responses required

NON-ACTIONABLE emails include:
- Generic job recommendations from portals (Naukri, LinkedIn, Indeed)
- Newsletter digests and career tips
- Application auto-confirmations ("We received your application")
- Marketing emails from job boards
- Promotional content or course advertisements
- Networking requests without specific opportunities
- Generic "Thanks for applying" without next steps

CLASSIFICATION RULES:
1. Focus on URGENCY and IMMEDIATE ACTION REQUIRED
2. Real recruiter names/companies are strong signals
3. Specific dates, times, or deadlines indicate actionable
4. Generic mass emails are NOT actionable
5. If unsure, err on the side of actionable (false positive > false negative)

OUTPUT FORMAT:
You must return a valid JSON array containing exactly ${emails.length} objects, each corresponding to the email in the input list in the exact same order.
Each object must have this exact structure:
{
  "actionable": true or false,
  "category": "interview" | "assessment" | "offer" | "shortlisted" | "rejected" | "recruiter_outreach" | "onboarding" | "other",
  "urgency": "high" | "medium" | "low",
  "deadline": "YYYY-MM-DD" or null (extract from email if present),
  "confidence": 0.0 to 1.0,
  "reason": "Brief explanation why this is/isn't actionable",
  "keyInfo": "Extract critical info: interview time, test link, deadline, etc."
}

IMPORTANT: 
- Return ONLY a valid JSON array. No markdown code block wrapper, no explanation, no text outside the JSON array.
- Order MUST match the input list index.
`;

  const formattedEmails = emails.map((email, idx) => ({
    index: idx,
    sender: email.sender,
    subject: email.subject,
    content: email.body || email.snippet || "",
  }));

  const userPrompt = `Classify this array of ${emails.length} emails:
${JSON.stringify(formattedEmails, null, 2)}`;

  const url = `${GEMINI_API_URL}/${MODEL}:generateContent?key=${apiKey}`;

  const requestBody = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096, // Higher for batch response
      responseMimeType: "application/json",
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Gemini API error (${response.status}): ${errorBody.substring(0, 300)}`
    );
  }

  const data = await response.json();
  const candidates = data.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error("Gemini returned no candidates");
  }

  const content = candidates[0]?.content;
  if (!content || !content.parts || content.parts.length === 0) {
    throw new Error("Gemini returned empty content");
  }

  return content.parts[0].text;
}

/**
 * Classify multiple emails in batch
 * Tries single API call batching first to save quota, falls back to sequential if needed.
 *
 * @param {Array} emails - Array of email objects
 * @returns {Object} { results: ClassifiedEmail[], errors: FailedEmail[] }
 */
export async function classifyEmails(emails) {
  if (!emails || emails.length === 0) {
    return { results: [], errors: [] };
  }

  logger.info(`📨 Starting batch classification of ${emails.length} emails...`);
  const startTime = Date.now();

  // Try single-call batching first to save API quota and bypass rate limits
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`🤖 Attempting single-request batch classification (attempt ${attempt}/${MAX_RETRIES})...`);
      const rawResponse = await callGeminiAPIBatch(emails);
      const classifications = extractJSON(rawResponse);

      if (!Array.isArray(classifications)) {
        throw new Error("Gemini did not return a JSON array");
      }

      if (classifications.length !== emails.length) {
        throw new Error(`Gemini returned ${classifications.length} results instead of expected ${emails.length}`);
      }

      const results = [];
      const errors = [];

      for (let i = 0; i < emails.length; i++) {
        const email = emails[i];
        const classification = classifications[i];

        try {
          // Validate the structure
          validateClassificationResponse(classification);

          classification.processedAt = new Date().toISOString();
          classification.processingTimeMs = Math.round((Date.now() - startTime) / emails.length);
          classification.model = MODEL;

          // Log this classification to terminal
          logger.classify(email.subject, classification);

          results.push({
            ...email,
            classification,
          });
        } catch (validationErr) {
          logger.error(`Validation failed for email "${email.subject}": ${validationErr.message}`);
          errors.push({
            ...email,
            error: validationErr.message,
          });
        }
      }

      logger.info(`✅ Single-request batch complete: ${results.length} classified, ${errors.length} failed`);
      return { results, errors };

    } catch (batchError) {
      logger.warn(`Single-request batch attempt ${attempt}/${MAX_RETRIES} failed: ${batchError.message}`);
      
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        logger.debug(`Retrying batch in ${delay}ms...`);
        await sleep(delay);
      } else {
        logger.error("❌ Single-request batching failed all attempts. Falling back to sequential classification...");
      }
    }
  }

  // FALLBACK: Local keyword-based heuristic classification (only if the single-request batching completely failed)
  const results = [];
  const errors = [];

  logger.warn("⚠️ Falling back to local keyword-based heuristic classification for this entire batch to protect API quota.");

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    try {
      const classification = classifyEmailFallback(email);
      results.push({
        ...email,
        classification,
      });
    } catch (error) {
      logger.error(`Failed local fallback for: "${email.subject}" — ${error.message}`);
      errors.push({
        ...email,
        error: error.message,
      });
    }
  }

  const actionable = results.filter((r) => r.classification.actionable);
  const nonActionable = results.filter((r) => !r.classification.actionable);

  logger.info(
    `✅ Local fallback batch complete: ${results.length} classified, ${errors.length} failed`
  );
  logger.info(
    `   🚨 Actionable: ${actionable.length} | 📭 Non-actionable: ${nonActionable.length}`
  );

  return { results, errors };
}

/**
 * Provide a fallback classification when AI is unavailable
 * Uses simple heuristics based on subject keywords
 *
 * @param {Object} email - Email object
 * @returns {Object} Fallback classification result
 */
export function classifyEmailFallback(email) {
  const subject = (email.subject || "").toLowerCase();
  const sender = (email.sender || "").toLowerCase();
  const content = `${email.subject || ""} ${email.snippet || ""} ${email.body || ""}`.toLowerCase();

  // Simple keyword-based heuristic fallback
  const interviewKeywords = ["interview", "phone screen", "technical round", "hr round"];
  const assessmentKeywords = ["assessment", "coding test", "online test", "challenge"];
  const offerKeywords = ["offer letter", "compensation", "job offer", "internship offer", "internship", "placement", "employment offer", "salary", "hiring", "offer"];
  const shortlistKeywords = ["shortlisted", "selected", "congratulations"];
  const rejectKeywords = ["unfortunately", "regret", "not selected", "rejected"];

  let classification = {
    actionable: false,
    category: "other",
    urgency: "low",
    deadline: null,
    confidence: 0.4, // Low confidence since it's a fallback
    reason: "Fallback heuristic classification (AI unavailable)",
    keyInfo: "Classified by keyword matching — verify manually",
    processedAt: new Date().toISOString(),
    model: "fallback-heuristic",
  };

  if (interviewKeywords.some((kw) => content.includes(kw))) {
    classification = {
      ...classification,
      actionable: true,
      category: "interview",
      urgency: "high",
      confidence: 0.6,
      reason: "Email contains interview-related keywords",
    };
  } else if (assessmentKeywords.some((kw) => content.includes(kw))) {
    classification = {
      ...classification,
      actionable: true,
      category: "assessment",
      urgency: "high",
      confidence: 0.6,
      reason: "Email contains assessment-related keywords",
    };
  } else if (offerKeywords.some((kw) => content.includes(kw))) {
    classification = {
      ...classification,
      actionable: true,
      category: "offer",
      urgency: "high",
      confidence: 0.6,
      reason: "Email contains offer or internship keywords",
    };
  } else if (shortlistKeywords.some((kw) => content.includes(kw))) {
    classification = {
      ...classification,
      actionable: true,
      category: "shortlisted",
      urgency: "medium",
      confidence: 0.55,
      reason: "Email contains shortlisting keywords",
    };
  } else if (rejectKeywords.some((kw) => content.includes(kw))) {
    classification = {
      ...classification,
      actionable: false,
      category: "rejected",
      urgency: "low",
      confidence: 0.5,
      reason: "Email contains rejection keywords",
    };
  }

  logger.classify(email.subject, classification);
  return classification;
}

/**
 * Get classification statistics from a batch of results
 *
 * @param {Array} classifiedEmails - Array of classified email objects
 * @returns {Object} Statistics summary
 */
export function getClassificationStats(classifiedEmails) {
  const stats = {
    total: classifiedEmails.length,
    actionable: 0,
    nonActionable: 0,
    byCategory: {},
    byUrgency: { high: 0, medium: 0, low: 0 },
    avgConfidence: 0,
    withDeadlines: 0,
  };

  let totalConfidence = 0;

  classifiedEmails.forEach(({ classification }) => {
    if (!classification) return;

    if (classification.actionable) {
      stats.actionable++;
    } else {
      stats.nonActionable++;
    }

    // Category breakdown
    const cat = classification.category;
    stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;

    // Urgency breakdown
    if (stats.byUrgency[classification.urgency] !== undefined) {
      stats.byUrgency[classification.urgency]++;
    }

    // Confidence
    totalConfidence += classification.confidence || 0;

    // Deadlines
    if (classification.deadline) {
      stats.withDeadlines++;
    }
  });

  stats.avgConfidence =
    classifiedEmails.length > 0
      ? +(totalConfidence / classifiedEmails.length).toFixed(3)
      : 0;

  return stats;
}
