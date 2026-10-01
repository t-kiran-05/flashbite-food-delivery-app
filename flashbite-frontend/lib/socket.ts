/**
 * @file lib/socket.ts
 * @description Singleton Socket.IO client for the FlashBite frontend.
 *              Reuses a single connection across the app; cleaned up on logout.
 *              Defaults to http://localhost:4000 if NEXT_PUBLIC_API_URL is unset.
 */
import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

/**
 * Returns (or creates) the shared Socket.IO connection.
 * Attaches JWT from localStorage for server-side auth middleware.
 */
export function getSocket(): Socket {
  if (!socket || !socket.connected) {
    const token = typeof window !== "undefined"
      ? localStorage.getItem("fb_token")
      : null;

    socket = io(
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
      {
        auth: { token },
        transports: ["websocket", "polling"],
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      }
    );

    socket.on("connect_error", (err) => {
      console.warn("[SOCKET] Connection error:", err.message);
    });
  }
  return socket;
}

/** Disconnects and resets the singleton instance (e.g. on logout). */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
