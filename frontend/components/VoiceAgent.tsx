"use client";

import { useState, useCallback, useRef } from "react";
import { useVAD, float32ToBytes, VADState } from "../hooks/useVAD";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAudioQueue } from "../hooks/useAudioQueue";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/v1/ws/voice-agent";

type AgentState = "disconnected" | "connecting" | "idle" | "listening" | "speaking" | "thinking" | "responding";

interface ConversationEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

/**
 * VoiceAgent — Main voice interaction component.
 *
 * Integrates VAD, WebSocket, and AudioQueue into a seamless voice experience.
 * Pipeline: Microphone → VAD → PCM16 bytes → WebSocket → STT → LLM → TTS → AudioContext
 */
export function VoiceAgent() {
  const [agentState, setAgentState] = useState<AgentState>("connecting");
  const [transcript, setTranscript] = useState("");
  const [currentResponse, setCurrentResponse] = useState("");
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const currentResponseRef = useRef("");

  // ── Audio queue for seamless TTS playback ──
  const audioQueue = useAudioQueue({
    onPlayStart: () => setAgentState("responding"),
    onPlayEnd: () => {
      if (agentState === "responding") setAgentState("idle");
    },
  });

  // ── WebSocket connection ──
  const { sendAudio, sendInterrupt } = useWebSocket({
    url: WS_URL,
    onOpen: () => setAgentState("idle"),
    onClose: () => setAgentState("disconnected"),
    onAudioChunk: (bytes) => {
      // MP3 audio chunk from TTS — enqueue for playback
      audioQueue.enqueue(bytes);
    },
    onMessage: (msg) => {
      if (typeof msg === "object" && "type" in msg) {
        switch (msg.type) {
          case "connected":
            setSessionId(msg.session_id || null);
            setAgentState("idle");
            break;
          case "transcript":
            setTranscript(msg.text || "");
            setAgentState("thinking");
            if (msg.text) {
              setConversation((prev) => [
                ...prev,
                { role: "user", text: msg.text!, timestamp: new Date() },
              ]);
            }
            break;
          case "text_chunk":
            currentResponseRef.current += (msg.text || "") + " ";
            setCurrentResponse(currentResponseRef.current);
            break;
          case "response_end":
            if (currentResponseRef.current.trim()) {
              setConversation((prev) => [
                ...prev,
                { role: "assistant", text: currentResponseRef.current.trim(), timestamp: new Date() },
              ]);
            }
            currentResponseRef.current = "";
            setCurrentResponse("");
            break;
          case "interrupted":
            audioQueue.clear();
            currentResponseRef.current = "";
            setCurrentResponse("");
            setAgentState("listening");
            break;
          case "error":
            console.error("[VoiceAgent] Backend error:", msg.message);
            setAgentState("idle");
            break;
        }
      }
    },
  });

  // ── VAD: detect speech and send audio ──
  const { state: vadState, start: startVAD, stop: stopVAD } = useVAD({
    onSpeechStart: () => {
      setAgentState("listening");
      // Interrupt any ongoing AI response
      if (audioQueue.isPlaying.current) {
        audioQueue.clear();
        sendInterrupt();
      }
    },
    onSpeechEnd: (audio) => {
      const bytes = float32ToBytes(audio);
      sendAudio(bytes);
      setAgentState("thinking");
    },
    onError: (err) => {
      if (err.name === "NotAllowedError") {
        setMicError("Permissão de microfone negada. Clique em 'Permitir' no navegador.");
      } else {
        setMicError(`Erro no microfone: ${err.message}`);
      }
    },
  });

  const handleStartListening = useCallback(async () => {
    setMicError(null);
    await startVAD();
  }, [startVAD]);

  const handleStop = useCallback(() => {
    stopVAD();
    audioQueue.clear();
    setAgentState("idle");
  }, [stopVAD, audioQueue]);

  const isActive = vadState === "listening" || vadState === "speaking";

  return (
    <div className="voice-agent">
      {/* Status indicator */}
      <div className={`status-orb status-${agentState}`}>
        <div className="orb-ring" />
        <div className="orb-core" />
      </div>

      <p className="status-label">{getStatusLabel(agentState, vadState)}</p>

      {/* Mic error */}
      {micError && (
        <div className="mic-error">
          <span>⚠️ {micError}</span>
        </div>
      )}

      {/* Controls */}
      <div className="controls">
        {!isActive ? (
          <button className="btn btn-start" onClick={handleStartListening} disabled={agentState === "connecting"}>
            🎙️ Começar a falar
          </button>
        ) : (
          <button className="btn btn-stop" onClick={handleStop}>
            ⏹ Parar
          </button>
        )}
      </div>

      {/* Live transcript */}
      {transcript && (
        <div className="transcript">
          <span className="label">Você:</span>
          <p>{transcript}</p>
        </div>
      )}

      {/* Live AI response */}
      {currentResponse && (
        <div className="response live">
          <span className="label">Alvinho:</span>
          <p>{currentResponse}<span className="cursor">▋</span></p>
        </div>
      )}

      {/* Conversation history */}
      {conversation.length > 0 && (
        <div className="conversation">
          {conversation.slice(-6).map((entry, i) => (
            <div key={i} className={`message message-${entry.role}`}>
              <span className="role">{entry.role === "user" ? "Você" : "Alvinho"}</span>
              <p>{entry.text}</p>
            </div>
          ))}
        </div>
      )}

      {sessionId && <p className="session-id">Sessão: {sessionId.slice(0, 8)}</p>}
    </div>
  );
}

function getStatusLabel(agentState: AgentState, vadState: VADState): string {
  switch (agentState) {
    case "connecting": return "Conectando...";
    case "idle": return "Pronto para ouvir";
    case "listening": return vadState === "speaking" ? "🔴 Ouvindo você..." : "Aguardando fala...";
    case "thinking": return "🧠 Processando...";
    case "responding": return "🔊 Alvinho está falando...";
    case "disconnected": return "Desconectado — reconectando...";
    default: return "";
  }
}
