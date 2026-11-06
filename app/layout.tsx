import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SavePal — Ship the work. Watch it get paid.",
  description: "Prove the work. Approve with confidence. Pay with PayPal.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600;700&display=swap" />
        <link rel="preload" as="image" href="/sky.webp" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
