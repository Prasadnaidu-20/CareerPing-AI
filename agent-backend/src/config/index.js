require("dotenv").config();

const config = {
  port: process.env.PORT || 5000,

  geminiApiKey:
    process.env.GEMINI_API_KEY || "",

  openaiApiKey:
    process.env.OPENAI_API_KEY || "",

  twilioSid:
    process.env.TWILIO_ACCOUNT_SID || "",

  twilioAuthToken:
    process.env.TWILIO_AUTH_TOKEN || "",

  twilioWhatsappNumber:
    process.env.TWILIO_WHATSAPP_NUMBER || "",
};

module.exports = config;