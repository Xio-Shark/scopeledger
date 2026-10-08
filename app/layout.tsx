import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ScopeLedger",
  description: "Reconcile scope changes and turn them into a real PayPal invoice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
