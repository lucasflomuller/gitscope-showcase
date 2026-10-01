import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "GitScope",
  description: "Eyeball diffs across your local git repositories before you open a PR.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Paint the mobile browser chrome to match the app surface instead of
  // leaving it white in dark mode. These track the OS preference, which is
  // also next-themes' default (`system`); a manual theme override in the
  // toggle won't repaint the chrome.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <body className="h-dvh overflow-hidden overscroll-none">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
