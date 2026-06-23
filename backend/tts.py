"""
tts.py — Text-to-Speech pipeline using OpenAI TTS (tts-1, voice: alloy or nova).

Receives text chunks from the LLM and returns audio bytes (MP3/PCM)
to be streamed back to the client via WebSocket.
"""

import os
import logging
import time
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None

# Voice configuration — "nova" has a natural Brazilian Portuguese sound
TTS_VOICE = os.getenv("TTS_VOICE", "nova")
TTS_MODEL = os.getenv("TTS_MODEL", "tts-1")  # tts-1 = low latency, tts-1-hd = high quality


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _client


async def synthesize(text: str) -> bytes:
    """
    Synthesize text to speech and return raw audio bytes (MP3).

    Args:
        text: The sentence to synthesize.

    Returns:
        MP3 audio bytes ready to be sent over WebSocket.
    """
    if not text or not text.strip():
        return b""

    t0 = time.perf_counter()

    try:
        client = _get_client()
        response = await client.audio.speech.create(
            model=TTS_MODEL,
            voice=TTS_VOICE,
            input=text,
            response_format="mp3",
        )
        audio_bytes = response.content
        latency_ms = (time.perf_counter() - t0) * 1000
        logger.info(f"[TTS] Synthesized {len(text)} chars in {latency_ms:.0f}ms → {len(audio_bytes)} bytes")
        return audio_bytes

    except Exception as exc:
        logger.error(f"[TTS] Synthesis error: {exc}")
        return b""
