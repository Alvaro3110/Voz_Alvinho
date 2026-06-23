import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Alvinho — Assistente de Voz IA",
  description: "Agente de voz em tempo real com STT, LLM e TTS de baixa latência",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        {/* Load VAD library from CDN — required before useVAD hook */}
        <Script
          src="https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.19/dist/bundle.min.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className={geist.className}>{children}</body>
    </html>
  );
}
