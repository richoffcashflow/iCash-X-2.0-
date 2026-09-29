import type { Metadata } from "next";
import "./beginner-workspace.css";
import "./bot-setup.css";
import "./conversion-clean.css";
export const metadata: Metadata = { title: "iCash X | Real Estate Wholesaling, Made Easy", description: "Set up your personalized AI real estate bot for free. Choose your look, voice and market, then a daily budget when live work is available.", icons: { icon: "/favicon.svg" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
