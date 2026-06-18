import axios from "axios";

const CONFIG = {
  USER_AGENT: "WEAO-3PService",
  TIMEOUT: 10000,
  URLS: {
    CURRENT: "https://weao.xyz/api/versions/current",
    PAST: "https://weao.xyz/api/versions/past"
  }
};

function handleApiError(error) {
  if (error.response?.status === 429) {
    const rateLimitInfo = error.response.data?.rateLimitInfo || {};
    throw {
      isRateLimit: true,
      remainingTime: rateLimitInfo.remainingTime
    };
  }
  throw error;
}

export async function fetchCurrentVersions() {
  try {
    const response = await axios.get(CONFIG.URLS.CURRENT, {
      headers: { "User-Agent": CONFIG.USER_AGENT },
      timeout: CONFIG.TIMEOUT
    });
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
}

export async function fetchPastVersions() {
  try {
    const response = await axios.get(CONFIG.URLS.PAST, {
      headers: { "User-Agent": CONFIG.USER_AGENT },
      timeout: CONFIG.TIMEOUT
    });
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
}