import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Little Penguin call detector",
  description: "Detect Little Penguin calls in long recordings, in your browser",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {process.env.NEXT_PUBLIC_COI_SERVICE_WORKER === "1" && (
        <head>
          {/* Hosts without COOP/COEP headers (GitHub Pages): a service worker adds them so
              multi-threaded WASM works. It reloads the page once on first visit. */}
          {/* eslint-disable-next-line @next/next/no-sync-scripts */}
          <script src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/coi-serviceworker.min.js`} />
        </head>
      )}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
