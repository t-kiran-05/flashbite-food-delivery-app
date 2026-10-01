import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "FlashBite — Multi-Tenant Ordering Platform",
  description: "Real-time restaurant ordering powered by Kafka, Redis, and Socket.IO",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-brand-bg text-[#f1f5f9] antialiased">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "#1e293b",
              color: "#f1f5f9",
              border: "1px solid #334155",
              borderRadius: "10px",
              fontSize: "14px",
            },
            success: { iconTheme: { primary: "#10b981", secondary: "#1e293b" } },
            error:   { iconTheme: { primary: "#ef4444", secondary: "#1e293b" } },
          }}
        />
      </body>
    </html>
  );
}
