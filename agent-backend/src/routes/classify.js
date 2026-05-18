const express = require("express");
const router = express.Router();

// ─── Lazy-load ESM modules ───────────────────────────────────────────────────

let classifierModule = null;
let filterModule = null;
let loggerModule = null;

async function loadModules() {
  if (!classifierModule) {
    classifierModule = await import("../services/ai-classifier.js");
  }
  if (!filterModule) {
    filterModule = await import("../services/filter.js");
  }
  if (!loggerModule) {
    loggerModule = await import("../utils/logger.js");
  }
}

function getLogger() {
  return loggerModule?.default;
}

// ─── POST /api/classify — Classify a single email ────────────────────────────

router.post("/", async (req, res) => {
  try {
    await loadModules();
    const logger = getLogger();

    const { sender, subject, snippet, body } = req.body;

    // Validate required fields
    if (!sender || !subject) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: sender and subject are required",
      });
    }

    const email = { sender, subject, snippet, body };

    // Step 1: Run through pre-filter
    const filterResult = filterModule.filterEmail(email);

    if (!filterResult.shouldProcess) {
      logger.info(`⏭️  Skipped (filtered): "${subject}" — ${filterResult.reason}`);
      return res.json({
        success: true,
        filtered: true,
        filterReason: filterResult.reason,
        classification: {
          actionable: false,
          category: "other",
          urgency: "low",
          deadline: null,
          confidence: 1.0,
          reason: `Pre-filtered: ${filterResult.reason}`,
          keyInfo: "Skipped AI classification — detected as noise",
        },
      });
    }

    // Step 2: Classify with AI
    let classification;
    try {
      classification = await classifierModule.classifyEmail(email);
    } catch (aiError) {
      logger.warn(`AI classification failed, using fallback: ${aiError.message}`);
      classification = classifierModule.classifyEmailFallback(email);
    }

    return res.json({
      success: true,
      filtered: false,
      classification,
    });
  } catch (error) {
    const logger = getLogger();
    logger?.error(`Classification route error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: "Internal server error during classification",
    });
  }
});

// ─── POST /api/classify/batch — Classify multiple emails ─────────────────────

router.post("/batch", async (req, res) => {
  try {
    await loadModules();
    const logger = getLogger();

    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Request body must contain a non-empty 'emails' array",
      });
    }

    // Cap batch size to prevent abuse
    const MAX_BATCH_SIZE = 20;
    if (emails.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        success: false,
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} emails`,
      });
    }

    // Validate each email has required fields
    for (let i = 0; i < emails.length; i++) {
      if (!emails[i].sender || !emails[i].subject) {
        return res.status(400).json({
          success: false,
          error: `Email at index ${i} is missing required fields (sender, subject)`,
        });
      }
    }

    logger.info(`📬 Batch request received: ${emails.length} emails`);

    // Step 1: Pre-filter all emails
    const { passed, filtered } = filterModule.filterEmails(emails);

    // Build results for filtered emails (no AI call needed)
    const filteredResults = filtered.map((email) => ({
      ...email,
      filtered: true,
      classification: {
        actionable: false,
        category: "other",
        urgency: "low",
        deadline: null,
        confidence: 1.0,
        reason: `Pre-filtered: ${email.filterReason}`,
        keyInfo: "Skipped AI classification — detected as noise",
      },
    }));

    // Step 2: Classify passed emails with AI
    let classifiedResults = [];
    let classificationErrors = [];

    if (passed.length > 0) {
      const { results, errors } = await classifierModule.classifyEmails(passed);
      classifiedResults = results.map((r) => ({ ...r, filtered: false }));
      classificationErrors = errors;
    }

    // Combine all results
    const allResults = [...classifiedResults, ...filteredResults];

    // Get stats
    const stats = classifierModule.getClassificationStats(
      allResults.filter((r) => r.classification)
    );

    // ─── Terminal Output ────────────────────────────────────────────────
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📨 CAREERPING — CLASSIFICATION RESULTS");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    allResults.forEach((item, idx) => {
      const c = item.classification;
      const icon = c.actionable ? "🚨 TRUE " : "❌ FALSE";
      const tag = item.filtered ? "[FILTERED]" : `[${(c.category || "").toUpperCase()}]`;

      console.log(`  ${idx + 1}. ${icon}  ${tag}`);
      console.log(`     Subject : ${item.subject}`);
      console.log(`     Sender  : ${item.sender}`);
      console.log(`     Urgency : ${c.urgency}   |   Confidence: ${c.confidence}`);
      console.log(`     Reason  : ${c.reason}`);
      if (c.deadline) console.log(`     Deadline: ${c.deadline}`);
      if (c.keyInfo)  console.log(`     Key Info: ${c.keyInfo}`);
      console.log("");
    });

    console.log(`  📊 Summary: ${stats.actionable} actionable, ${stats.nonActionable} not actionable, ${filtered.length} pre-filtered`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    // ─── End Terminal Output ────────────────────────────────────────────

    return res.json({
      success: true,
      stats: {
        ...stats,
        filtered: filtered.length,
        errors: classificationErrors.length,
      },
      results: allResults,
      errors: classificationErrors,
    });
  } catch (error) {
    const logger = getLogger();
    logger?.error(`Batch classification error: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: "Internal server error during batch classification",
    });
  }
});

// ─── POST /api/classify/save-token — Save Google Access Token for background polling ───────────
router.post("/save-token", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: "Access token is required" });
    }

    const pollerModule = await import("../services/gmail-poller.js");
    pollerModule.setAccessToken(token);

    return res.json({ success: true, message: "Token saved and background polling active" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ─── GET /api/classify/health — Health check for classifier ──────────────────

router.get("/health", async (req, res) => {
  try {
    const hasApiKey = !!process.env.GEMINI_API_KEY;

    return res.json({
      success: true,
      service: "ai-classifier",
      status: hasApiKey ? "ready" : "degraded",
      geminiConfigured: hasApiKey,
      fallbackAvailable: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: "error",
      error: error.message,
    });
  }
});

module.exports = router;
