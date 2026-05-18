/**
 * Send WhatsApp notification alert using direct Twilio REST API
 */
export async function sendWhatsAppAlert(email, classification) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
  const toNumber = process.env.USER_PHONE_NUMBER || process.env.TWILIO_USER_PHONE_NUMBER;

  const subject = email.subject;
  const sender = email.sender.split("<")[0].trim() || email.sender;
  const category = (classification.category || "opportunity").toUpperCase();
  const urgency = (classification.urgency || "medium").toUpperCase();
  const deadline = classification.deadline ? `\n📅 *Deadline:* ${classification.deadline}` : "";
  const keyInfo = classification.keyInfo ? `\n💡 *Info:* ${classification.keyInfo}` : "";
  const reason = classification.reason ? `\n\n_Reason: ${classification.reason}_` : "";

  const messageBody = `🚨 *CareerPing AI Alert: [${category}]*
  
✉️ *From:* ${sender}
📌 *Subject:* ${subject}
🔥 *Urgency:* ${urgency}${deadline}${keyInfo}${reason}`;

  console.log("\n💬 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📨 SENDING WHATSAPP ALERT:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(messageBody);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (!accountSid || !authToken || !fromNumber || !toNumber) {
    console.warn("⚠️ WhatsApp Alert Simulated: Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER) or destination phone (USER_PHONE_NUMBER) are missing in your backend .env file.");
    return false;
  }

  try {
    const formattedFrom = fromNumber.startsWith("whatsapp:") ? fromNumber : `whatsapp:${fromNumber}`;
    const formattedTo = toNumber.startsWith("whatsapp:") ? toNumber : `whatsapp:${toNumber}`;

    const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        From: formattedFrom,
        To: formattedTo,
        Body: messageBody
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Twilio returned error status (${response.status}): ${errText}`);
    }

    const data = await response.json();
    console.log(`✅ WhatsApp alert successfully sent via Twilio! SID: ${data.sid}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send WhatsApp notification via Twilio: ${err.message}`);
    return false;
  }
}
