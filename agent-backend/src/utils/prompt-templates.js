/**
 * Prompt templates for AI email classification
 * Contains system instructions, few-shot examples, and output format
 */

/**
 * System prompt that defines the AI's role and classification criteria
 */
export const SYSTEM_PROMPT = `You are an intelligent email classifier for CareerPing, a career opportunity detection system.

Your job is to analyze emails and determine if they represent ACTIONABLE career opportunities that require immediate attention from a job seeker.

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
Return ONLY a valid JSON object with this exact structure:
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
- Return ONLY the JSON object, no markdown, no explanation, no code blocks
- If no deadline is mentioned, set "deadline": null
- confidence should reflect how certain you are (0.5 = unsure, 0.9 = very sure)
`;

/**
 * Few-shot examples to improve accuracy
 */
export const FEW_SHOT_EXAMPLES = [
  {
    email: {
      sender: "Sarah Johnson <sarah@techcorp.com>",
      subject: "Interview Invitation - Senior Software Engineer Position",
      snippet: "Hi, We'd like to invite you for a technical interview on May 22nd at 3 PM IST. Please confirm your availability.",
    },
    expectedOutput: {
      actionable: true,
      category: "interview",
      urgency: "high",
      deadline: "2026-05-22",
      confidence: 0.95,
      reason: "Direct interview invitation from recruiter with specific date and time",
      keyInfo: "Technical interview scheduled for May 22nd at 3 PM IST",
    },
  },
  {
    email: {
      sender: "Naukri <noreply@naukri.com>",
      subject: "10 New Jobs Matching Your Profile",
      snippet: "Dear Job Seeker, We found 10 new jobs that match your skills. Click here to view recommended jobs.",
    },
    expectedOutput: {
      actionable: false,
      category: "other",
      urgency: "low",
      deadline: null,
      confidence: 0.98,
      reason: "Generic job aggregator recommendation email, not a direct opportunity",
      keyInfo: "None - automated job portal digest",
    },
  },
  {
    email: {
      sender: "HackerRank Assessments <recruit@hackerrank.com>",
      subject: "Complete Your Coding Assessment for ABC Corp",
      snippet: "You have been invited to complete a coding assessment. Deadline: May 20, 2026. Test link: https://...",
    },
    expectedOutput: {
      actionable: true,
      category: "assessment",
      urgency: "high",
      deadline: "2026-05-20",
      confidence: 0.92,
      reason: "Coding assessment with specific deadline from real company",
      keyInfo: "Coding test for ABC Corp, deadline May 20, 2026",
    },
  },
  {
    email: {
      sender: "LinkedIn Jobs <jobalerts-noreply@linkedin.com>",
      subject: "Weekly job recommendations based on your activity",
      snippet: "Here are some jobs we think you'll like based on your recent searches and profile views.",
    },
    expectedOutput: {
      actionable: false,
      category: "other",
      urgency: "low",
      deadline: null,
      confidence: 0.96,
      reason: "Automated weekly digest from LinkedIn, not a direct application response",
      keyInfo: "None - generic recommendations",
    },
  },
  {
    email: {
      sender: "HR Team - DataCo <hr@dataco.in>",
      subject: "Congratulations! You've been shortlisted",
      snippet: "We are pleased to inform you that you have been shortlisted for the Data Analyst position. Next round details will be shared by May 19th.",
    },
    expectedOutput: {
      actionable: true,
      category: "shortlisted",
      urgency: "medium",
      deadline: "2026-05-19",
      confidence: 0.93,
      reason: "Shortlisting notification from company HR with next steps timeline",
      keyInfo: "Shortlisted for Data Analyst role, next round info by May 19th",
    },
  },
];

/**
 * Build the complete user prompt with email data and examples
 */
export function buildClassificationPrompt(email) {
  const { sender, subject, snippet, body } = email;

  // Use body if available, otherwise use snippet
  const content = body || snippet || "";

  return `Analyze this email and classify it:

SENDER: ${sender}
SUBJECT: ${subject}
CONTENT: ${content}

Remember:
- Return ONLY valid JSON
- Focus on whether IMMEDIATE ACTION is required
- Extract deadline dates in YYYY-MM-DD format
- If no deadline mentioned, use null
- Be conservative with confidence scores

Classify this email now:`;
}

/**
 * Validate AI response format
 */
export function validateClassificationResponse(response) {
  const required = ["actionable", "category", "urgency", "confidence", "reason"];
  const categories = ["interview", "assessment", "offer", "shortlisted", "rejected", "recruiter_outreach", "onboarding", "other"];
  const urgencyLevels = ["high", "medium", "low"];

  // Check required fields
  for (const field of required) {
    if (!(field in response)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Validate types
  if (typeof response.actionable !== "boolean") {
    throw new Error("actionable must be boolean");
  }

  if (!categories.includes(response.category)) {
    throw new Error(`Invalid category: ${response.category}`);
  }

  if (!urgencyLevels.includes(response.urgency)) {
    throw new Error(`Invalid urgency: ${response.urgency}`);
  }

  if (typeof response.confidence !== "number" || response.confidence < 0 || response.confidence > 1) {
    throw new Error("confidence must be a number between 0 and 1");
  }

  // Deadline should be null or valid date string
  if (response.deadline !== null && !/^\d{4}-\d{2}-\d{2}$/.test(response.deadline)) {
    throw new Error("deadline must be null or YYYY-MM-DD format");
  }

  return true;
}

/**
 * Format examples as part of the system prompt (for few-shot learning)
 */
export function getSystemPromptWithExamples() {
  const examplesText = FEW_SHOT_EXAMPLES.map((example, idx) => {
    return `
EXAMPLE ${idx + 1}:
Sender: ${example.email.sender}
Subject: ${example.email.subject}
Snippet: ${example.email.snippet}

Expected Output:
${JSON.stringify(example.expectedOutput, null, 2)}
`;
  }).join("\n---\n");

  return `${SYSTEM_PROMPT}

HERE ARE EXAMPLES TO LEARN FROM:
${examplesText}

Now, when you receive an email to classify, follow this exact pattern.`;
}