import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LiteParse Financial Research Agent",
  description: "Financial research agent powered by LiteParse",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-200 antialiased">{children}</body>
    </html>
  );
}
