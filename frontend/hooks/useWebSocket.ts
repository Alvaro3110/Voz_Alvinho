"use client";

import { useEffect, useRef, useCallback } from "react";

type AudioQueueMessage =
  | { type: "text_chunk" | "transcript" | "response_end" | "interrupted" | "connected" | "error"; text?: string; message?: string; session_id?: string }
  | ArrayBuffer;

interface UseWebSocketOptions {
  url: string;
  onMessage: (msg: AudioQueueMessage) => void;
  onAudioChunk: (bytes: ArrayBuffer) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (e: Event) => void;
}

/**
 * useWebSocket — manages a persistent WebSocket connection to the voice agent backend.
 *
 * Handles:
 * - Binary frames (audio MP3 chunks from TTS)
 * - JSON frames (control messages: transcript, text_chunk, response_end, etc.)
 * - Auto-reconnect on unexpected close
 */
export function useWebSocket({
  url,
  onMessage,
  onAudioChunk,
  onOpen,
  onClose,
  onError,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isIntentionalClose = useRef(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      onOpen?.();
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        onAudioChunk(event.data);
      } else if (typeof event.data === "string") {
        try {
          const parsed = JSON.parse(event.data);
          onMessage(parsed);
        } catch {
          // ignore malformed
        }
      }
    };

    ws.onclose = () => {
      onClose?.();
      if (!isIntentionalClose.current) {
        // Auto-reconnect after 2s
        reconnectTimerRef.current = setTimeout(connect, 2000);
      }
    };

    ws.onerror = (e) => {
      onError?.(e);
    };
  }, [url, onMessage, onAudioChunk, onOpen, onClose, onError]);

  const disconnect = useCallback(() => {
    isIntentionalClose.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();
  }, []);

  const sendAudio = useCallback((pcm16Bytes: Uint8Array) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const payload = pcm16Bytes.buffer.slice(
        pcm16Bytes.byteOffset,
        pcm16Bytes.byteOffset + pcm16Bytes.byteLength
      );
      wsRef.current.send(payload);
    }
  }, []);

  const sendInterrupt = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
  }, []);

  useEffect(() => {
    isIntentionalClose.current = false;
    connect();
    return () => {
      isIntentionalClose.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { sendAudio, sendInterrupt, disconnect, reconnect: connect };
}
