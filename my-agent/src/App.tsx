import { useState } from "react";
import { loginWithGoogle } from "./services/auth";
import { getProfile, fetchEmails, classifyEmailsWithBackend, saveTokenToBackend } from "./services/gmail";
import type { ClassifiedEmail } from "./services/gmail";

function App() {
  const [profile, setProfile] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [emails, setEmails] = useState<ClassifiedEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await loginWithGoogle();
      setAccessToken(token);
      console.log("ACCESS TOKEN:", token);

      // Save token to backend for 30-sec polling and WhatsApp alerting
      await saveTokenToBackend(token);

      const profileData = await getProfile(token);
      console.log("PROFILE DATA:", profileData);
      setProfile(profileData);

      // Automatically trigger email fetch and classification on login
      await handleScan(token);
    } catch (err: any) {
      console.error("Login Error:", err);
      setError(err.message || "Failed to log in with Google");
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async (token = accessToken) => {
    if (!token) return;
    setScanning(true);
    setError(null);
    try {
      // Keep backend access token fresh
      await saveTokenToBackend(token);

      console.log("Fetching recent emails from Gmail API...");
      const emailList = await fetchEmails(token, 5);
      
      console.log(`Sending ${emailList.length} emails to CareerPing backend for AI analysis...`);
      const backendResponse = await classifyEmailsWithBackend(emailList);
      
      console.log("AI Classification Success:", backendResponse);
      setEmails(backendResponse.results);
    } catch (err: any) {
      console.error("Scan/Classification Error:", err);
      setError(err.message || "Failed to fetch and classify emails");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="p-6 max-w-sm mx-auto bg-gray-900 text-white rounded-xl shadow-md space-y-4">
      <h1 className="text-2xl font-bold text-center">CareerPing AI</h1>

      {profile ? (
        <div className="space-y-4">
          <div className="bg-gray-800 p-4 rounded-lg space-y-2">
            <div className="flex items-center space-x-2 text-green-400">
              <span className="text-lg">✅</span>
              <span className="font-semibold">Connected to Gmail</span>
            </div>
            <p className="text-xs text-gray-300">
              User: <span className="font-mono text-white text-[11px]">{profile.emailAddress}</span>
            </p>
            <div className="flex justify-between items-center pt-2">
              <span className="text-xs text-gray-400">Messages: {profile.messagesTotal}</span>
              <button
                onClick={() => handleScan()}
                disabled={scanning}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold py-1.5 px-3 rounded transition-all duration-150"
              >
                {scanning ? "AI Scanning..." : "Scan & Classify"}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-400">AI Analysed Emails ({emails.length})</h2>
            
            {emails.length === 0 && !scanning && (
              <p className="text-xs text-gray-500 text-center">No emails found or loaded.</p>
            )}

            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {emails.map((email) => {
                const c = email.classification;
                const isActionable = c && c.actionable;
                const categoryName = c ? c.category.toUpperCase() : "HEURISTIC";

                // Set urgency colors
                let urgencyBadgeColor = "bg-gray-700 text-gray-300";
                if (c && c.urgency === "high") urgencyBadgeColor = "bg-red-500 text-white font-bold animate-pulse";
                else if (c && c.urgency === "medium") urgencyBadgeColor = "bg-yellow-500 text-black font-semibold";

                return (
                  <div
                    key={email.id}
                    className={`p-3 rounded-lg border transition-colors space-y-2 ${
                      isActionable
                        ? "bg-blue-950/40 border-blue-800/80 hover:bg-blue-950/60"
                        : "bg-gray-800/55 border-gray-700/50 hover:bg-gray-800/75"
                    }`}
                  >
                    {/* Header: Sender & Time */}
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-xs font-semibold text-blue-300 truncate max-w-[70%]">
                        {email.sender.split("<")[0].trim() || email.sender}
                      </span>
                      <span className="text-[10px] text-gray-500 shrink-0">
                        {email.time.split(",")[1]?.trim() || email.time.split(" ")[0]}
                      </span>
                    </div>

                    {/* Subject Line & Badges */}
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {email.unread && (
                          <span className="bg-blue-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0">
                            NEW
                          </span>
                        )}
                        {c && (
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 ${urgencyBadgeColor}`}>
                            {categoryName}
                          </span>
                        )}
                        {isActionable && (
                          <span className="bg-emerald-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0">
                            🚨 ACTIONABLE
                          </span>
                        )}
                      </div>
                      <h3 className={`text-xs truncate ${email.unread ? "font-bold text-white" : "text-gray-200"}`}>
                        {email.subject}
                      </h3>
                    </div>

                    {/* Snippet / Description */}
                    <p className="text-[10px] text-gray-400 line-clamp-2 leading-relaxed">
                      {email.snippet}
                    </p>

                    {/* AI Insights & Reasoning */}
                    {isActionable && c && (
                      <div className="bg-black/30 p-2 rounded text-[9px] space-y-1 border border-emerald-900/30">
                        <p className="text-emerald-400 font-semibold">
                          💡 Info: <span className="text-white font-normal">{c.keyInfo}</span>
                        </p>
                        {c.deadline && (
                          <p className="text-yellow-400 font-semibold animate-pulse">
                            📅 Deadline: <span className="text-white font-normal">{c.deadline}</span>
                          </p>
                        )}
                        <p className="text-gray-400 font-mono italic leading-normal text-[8px]">
                          Reason: {c.reason}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-400 text-center">
            Connect your Gmail account to scan and filter job opportunities.
          </p>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded transition-all duration-150"
          >
            {loading ? "Connecting..." : "Connect Gmail"}
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 text-xs p-3 rounded">
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}

export default App;