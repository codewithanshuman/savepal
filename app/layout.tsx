import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SavePal — Work assurance",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
