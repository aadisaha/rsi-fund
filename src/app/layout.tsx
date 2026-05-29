import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Recursive Quant Fund MVP",
  description: "Paper-only quant-fund cockpit and research lab.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
