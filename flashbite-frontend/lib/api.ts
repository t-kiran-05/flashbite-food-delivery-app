/**
 * @file lib/api.ts
 * @description Axios instance pre-configured for the FlashBite Express backend.
 *              Attaches JWT from localStorage on every request automatically.
 *              Defaults to http://localhost:4000 if NEXT_PUBLIC_API_URL is unset.
 */
import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

// Attach JWT on every outgoing request
api.interceptors.request.use(
  (config) => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("fb_token");
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle 401 Unauthorized
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window !== "undefined") {
      if (error.response?.status === 401) {
        // Clear stale session
        localStorage.removeItem("fb_token");
        localStorage.removeItem("fb_user");
      }
    }
    return Promise.reject(error);
  }
);

export default api;
