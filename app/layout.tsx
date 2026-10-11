import {WebinarMeasurement} from "@/components/webinar-measurement";
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
import "./workspace-minimal.css";
import "./workspace-assistant.css";
import "./agreement-cancellation.css";
export const metadata: Metadata = { title: "iCash X | Your AI Bot for Wholesale Real Estate", description: "Automate wholesale real estate with your AI bot. Property research, seller calls, texts, follow-up and deal tools in one workspace. Software access is $50/month; work credits are separate.", icons: { icon: "/favicon.svg?v=chrome-x" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}<WebinarMeasurement/></body></html>; }
