export async function loginWithGoogle(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken(
      { interactive: true },
      (token: any) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        if (typeof token === "string" && token) {
          resolve(token);
        } else if (token && typeof token === "object" && token.token) {
          resolve(token.token);
        } else {
          reject(new Error("No token received"));
        }
      }
    );
  });
}