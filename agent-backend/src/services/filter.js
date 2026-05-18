import logger from "../utils/logger.js";
// Force restart to reload empty processed-emails cache

// ─── Noise Detection Rules ────────────────────────────────────────────────────

const NOISE_SENDERS = [
  // Generic no-reply addresses 
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "no_reply",
  "mailer-daemon",
  "postmaster",

  // Job portals (aggregate notifications, not direct opportunities)
  "naukri.com",
  "monster.com",
  "indeed.com",
  "linkedin.com/jobs",
  "glassdoor.com",
  "shine.com",
  "foundit.in",
  "jobs@",
  "alerts@",
  "notifications@linkedin",
  "jobs-listings@",
  "job-alert",

  // Marketing/Newsletter services
  "mailchimp",
  "sendgrid",
  "constantcontact",
  "newsletter",
  "marketing@",
  "promo@",
  "offers@",
  "deals@",

  // Social media notifications
  "facebookmail",
  "twitter.com",
  "instagram.com",
  "notification@",
  "updates@",

  // E-commerce
  "amazon.com",
  "flipkart.com",
  "myntra.com",
  "swiggy.com",
  "zomato.com",
  "order@",
  "delivery@",
];

const NOISE_KEYWORDS = [
  // Unsubscribe indicators (always marketing)
  "unsubscribe",
  "opt out",
  "manage preferences",
  "email preferences",

  // Promotional language
  "sale",
  "discount",
  "off on",
  "% off",
  "coupon",
  "promo code",
  "limited time",
  "deal",
  "special offer",
  "promo offer",
  "exclusive offer",
  "buy now",
  "shop now",
  "free shipping",

  // Newsletter indicators
  "newsletter",
  "weekly digest",
  "daily digest",
  "monthly update",
  "roundup",

  // Job aggregator spam (not direct opportunities)
  "jobs for you",
  "new jobs",
  "job recommendations",
  "recommended jobs",
  "jobs matching",
  "job alerts",
  "similar jobs",
];

// Keywords that indicate a REAL opportunity (overrides noise detection)
const PRIORITY_KEYWORDS = [
  // Interview-related
  "interview",
  "interview invitation",
  "interview scheduled",
  "interview request",
  "interview confirmation",
  "phone screen",
  "technical interview",
  "hr round",
  "final round",

  // Assessment/Test
  "assessment",
  "online test",
  "coding test",
  "aptitude test",
  "assignment",
  "take-home",
  "coding challenge",

  // Selection-related
  "shortlisted",
  "selected",
  "congratulations",
  "offer letter",
  "job offer",
  "internship",
  "internship offer",
  "placement",
  "acceptance",
  "onboarding",
  "joining date",
  "joining letter",

  // Deadlines
  "deadline",
  "last date",
  "expires on",
  "respond by",
  "confirm by",
];

// ─── Filter Logic ─────────────────────────────────────────────────────────────

/**
 * Check if sender is from a noise source
 */
function isNoiseSender(sender) {
  const lowerSender = sender.toLowerCase();
  return NOISE_SENDERS.some((pattern) => lowerSender.includes(pattern));
}

/**
 * Check if subject contains noise keywords
 */
function hasNoiseKeywords(subject) {
  const lowerSubject = subject.toLowerCase();
  return NOISE_KEYWORDS.some((keyword) => lowerSubject.includes(keyword));
}

/**
 * Check if email contains priority keywords (real opportunities)
 */
function hasPriorityKeywords(email) {
  const subject = (email.subject || "").toLowerCase();
  const snippet = (email.snippet || "").toLowerCase();
  const body = (email.body || "").toLowerCase();

  return PRIORITY_KEYWORDS.some(
    (keyword) =>
      subject.includes(keyword) ||
      snippet.includes(keyword) ||
      body.includes(keyword)
  );
}

/**
 * Main filter function
 * Returns { shouldProcess: boolean, reason: string }
 */
export function filterEmail(email) {
  const { sender, subject } = email;

  // Priority check: If contains critical keywords, always process
  if (hasPriorityKeywords(email)) {
    logger.debug(`✓ Priority keywords detected: "${subject}"`);
    return { shouldProcess: true, reason: "priority_keywords" };
  }

  // Check sender
  if (isNoiseSender(sender)) {
    logger.filter(subject, "noise sender");
    return { shouldProcess: false, reason: "noise_sender" };
  }

  // Check subject keywords
  if (hasNoiseKeywords(subject)) {
    logger.filter(subject, "noise keywords in subject");
    return { shouldProcess: false, reason: "noise_keywords" };
  }

  // Passed all checks
  return { shouldProcess: true, reason: "passed_filters" };
}

/**
 * Batch filter multiple emails
 * Returns { passed: EmailData[], filtered: EmailData[] }
 */
export function filterEmails(emails) {
  const passed = [];
  const filtered = [];

  emails.forEach((email) => {
    const result = filterEmail(email);
    if (result.shouldProcess) {
      passed.push(email);
    } else {
      filtered.push({ ...email, filterReason: result.reason });
    }
  });

  logger.info(
    `Filtering complete: ${passed.length} passed, ${filtered.length} filtered`
  );

  return { passed, filtered };
}

/**
 * Get filter statistics
 */
export function getFilterStats(emails) {
  let noiseSenders = 0;
  let noiseKeywords = 0;
  let priority = 0;
  let passed = 0;

  emails.forEach((email) => {
    const result = filterEmail(email);
    
    if (result.reason === "priority_keywords") priority++;
    else if (result.reason === "noise_sender") noiseSenders++;
    else if (result.reason === "noise_keywords") noiseKeywords++;
    else if (result.shouldProcess) passed++;
  });

  return {
    total: emails.length,
    passed,
    priority,
    filtered: {
      total: noiseSenders + noiseKeywords,
      noiseSenders,
      noiseKeywords,
    },
  };
}