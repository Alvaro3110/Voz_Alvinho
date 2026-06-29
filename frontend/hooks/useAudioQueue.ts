"use client";

import { useCallback, useRef } from "react";

/**
 * useAudioQueue — MEU-16: Audio playback queue using Web Audio API.
 *
 * Receives MP3 chunks from TTS and plays them sequentially without gaps or pops.
 * Supports immediate interruption (queue.clear() + stop current playback).
 * Uses AudioContext for surgical buffer management.
 */

interface UseAudioQueueOptions {
  onPlayStart?: () => void;
  onPlayEnd?: () => void;
}

export function useAudioQueue({ onPlayStart, onPlayEnd }: UseAudioQueueOptions = {}) {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const generationRef = useRef(0);

  const getContext = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext({ sampleRate: 44100 });
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  /**
   * Enqueue an MP3 audio chunk received from the WebSocket.
   * Decodes and schedules playback back-to-back with the previous chunk.
   */
  const enqueue = useCallback(
    async (mp3Bytes: ArrayBuffer) => {
      const ctx = getContext();
      const generation = generationRef.current;

      try {
        const audioBuffer = await ctx.decodeAudioData(mp3Bytes.slice(0));
        if (generation !== generationRef.current) return;

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        // Schedule to play exactly when previous chunk ends
        const now = ctx.currentTime;
        const startAt = Math.max(now, nextStartTimeRef.current);

        source.start(startAt);
        nextStartTimeRef.current = startAt + audioBuffer.duration;
        sourceQueueRef.current.push(source);

        if (!isPlayingRef.current) {
          isPlayingRef.current = true;
          onPlayStart?.();
        }

        source.onended = () => {
          if (generation !== generationRef.current) return;
          sourceQueueRef.current = sourceQueueRef.current.filter((s) => s !== source);
          if (sourceQueueRef.current.length === 0 && isPlayingRef.current) {
            isPlayingRef.current = false;
            onPlayEnd?.();
          }
        };
      } catch (err) {
        console.error("[AudioQueue] Failed to decode audio chunk:", err);
      }
    },
    [getContext, onPlayStart, onPlayEnd]
  );

  /**
   * Immediately stop all audio and clear the queue.
   * Called when the user interrupts the AI mid-speech.
   */
  const clear = useCallback(() => {
    generationRef.current += 1;
    const queuedSources = sourceQueueRef.current;
    sourceQueueRef.current = [];
    nextStartTimeRef.current = 0;

    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      onPlayEnd?.();
    }

    // Stop all scheduled sources immediately
    queuedSources.forEach((source) => {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // Already stopped
      }
    });
  }, [onPlayEnd]);

  return { enqueue, clear, isPlaying: isPlayingRef };
}
