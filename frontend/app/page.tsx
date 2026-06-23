import { VoiceAgent } from "../components/VoiceAgent";

export default function Home() {
  return (
    <main className="main">
      <header className="header">
        <div className="logo">
          <span className="logo-icon">🎙️</span>
          <h1>Alvinho</h1>
        </div>
        <p className="tagline">Assistente de voz em tempo real</p>
      </header>
      <VoiceAgent />
    </main>
  );
}
