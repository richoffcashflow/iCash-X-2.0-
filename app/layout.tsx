import type { Metadata } from "next";
import "./beginner-workspace.css";
import "./bot-setup.css";
import "./conversion-clean.css";
import "./ui-reliability.css";
import "./bot-building.css";
import "./workspace-volume.css";
import "./workspace-simple-cards.css";
import "./workspace-clarity.css";
import "./onboarding-conversion.css";
import "./conversation-hub.css";
import "./membership.css";
export const metadata: Metadata = { title: "iCash X | Real Estate Wholesaling, Made Easy", description: "Create your AI real estate bot. Get software access, add prepaid work credits, and follow property research, seller conversations, and deal progress in one workspace.", icons: { icon: "/favicon.svg" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
