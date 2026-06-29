"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// @ricky0123/vad-web loaded from CDN via useEffect
type VADInstance = {
  start: () => void;
  pause: () => void;
  destroy: () => void;
};

export type VADState = "idle" | "loading" | "listening" | "speaking" | "error";

interface UseVADOptions {
  onSpeechStart?: () => void;
  onSpeechEnd?: (audioData: Float32Array) => void;
  onError?: (error: Error) => void;
}

/**
 * useVAD — integrates @ricky0123/vad-web (Silero ONNX) for local voice activity detection.
 *
 * Audio format output: Float32Array at 16kHz mono (VAD native format).
 * The caller converts the final Float32Array segment to PCM16 bytes before
 * WebSocket transmission.
 */
export function useVAD({ onSpeechStart, onSpeechEnd, onError }: UseVADOptions = {}) {
  const [state, setState] = useState<VADState>("idle");
  const vadRef = useRef<VADInstance | null>(null);
  const activeRef = useRef(false);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    setState("loading");

    try {
      // Dynamic import from CDN (loaded in layout.tsx via script tag)
      const { MicVAD } = await import("@ricky0123/vad-web");

      vadRef.current = await MicVAD.new({
        onSpeechStart: () => {
          setState("speaking");
          onSpeechStart?.();
        },
        onSpeechEnd: (audio: Float32Array) => {
          setState("listening");
          onSpeechEnd?.(audio);
        },
        onVADMisfire: () => {
          setState("listening");
        },
        positiveSpeechThreshold: 0.6,
        negativeSpeechThreshold: 0.35,
        minSpeechFrames: 4,
        preSpeechPadFrames: 1,
        redemptionFrames: 8,
      });

      await vadRef.current.start();
      activeRef.current = true;
      setState("listening");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState("error");
      onError?.(error);
    }
  }, [onSpeechStart, onSpeechEnd, onError]);

  const stop = useCallback(() => {
    vadRef.current?.pause();
    activeRef.current = false;
    setState("idle");
  }, []);

  const destroy = useCallback(() => {
    vadRef.current?.destroy();
    vadRef.current = null;
    activeRef.current = false;
    setState("idle");
  }, []);

  useEffect(() => {
    return () => {
      vadRef.current?.destroy();
    };
  }, []);

  return { state, start, stop, destroy };
}

/**
 * Convert Float32Array to raw PCM16 bytes (Uint8Array) for WebSocket binary send.
 */
export function float32ToBytes(float32: Float32Array): Uint8Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(int16.buffer);
}
