"""
stt.py — Speech-to-Text pipeline using Groq Whisper (ultra-low latency, pt-BR).

Receives raw PCM audio bytes and returns the transcribed text.
Uses Groq's Whisper API via HTTP — no temp files, streaming-friendly.
"""

import io
import os
import time
import logging
from groq import AsyncGroq

logger = logging.getLogger(__name__)

# Groq client — reads GROQ_API_KEY from env
_client: AsyncGroq | None = None


def _get_client() -> AsyncGroq:
    global _client
    if _client is None:
        _client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
    return _client


async def transcribe(audio_bytes: bytes, sample_rate: int = 16000) -> str:
    """
    Transcribe raw PCM16 mono audio bytes to text using Groq Whisper large-v3-turbo.

    Args:
        audio_bytes: Raw PCM16 mono bytes at 16kHz (format expected by VAD on the frontend).
        sample_rate: Sample rate in Hz (default 16000).

    Returns:
        Transcribed text string, or empty string on failure.
    """
    if not audio_bytes:
        return ""

    t0 = time.perf_counter()

    # Groq Whisper expects a WAV-like file object. We wrap the PCM in a minimal WAV header.
    wav_bytes = _pcm_to_wav(audio_bytes, sample_rate=sample_rate)

    # Wrap in a file-like object that mimics an uploaded file
    audio_file = io.BytesIO(wav_bytes)
    audio_file.name = "audio.wav"

    try:
        client = _get_client()
        response = await client.audio.transcriptions.create(
            file=audio_file,
            model="whisper-large-v3-turbo",
            language="pt",
            response_format="text",
        )
        latency_ms = (time.perf_counter() - t0) * 1000
        text = response.strip() if isinstance(response, str) else ""
        logger.info(f"[STT] Transcribed in {latency_ms:.0f}ms: '{text[:80]}'")
        return text
    except Exception as exc:
        logger.error(f"[STT] Transcription error: {exc}")
        return ""


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 16000, channels: int = 1, bit_depth: int = 16) -> bytes:
    """Wrap raw PCM16 bytes in a minimal WAV container."""
    import struct

    num_samples = len(pcm_bytes) // (bit_depth // 8)
    byte_rate = sample_rate * channels * (bit_depth // 8)
    block_align = channels * (bit_depth // 8)
    data_size = len(pcm_bytes)
    chunk_size = 36 + data_size

    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        chunk_size,
        b"WAVE",
        b"fmt ",
        16,           # PCM subchunk size
        1,            # AudioFormat: PCM
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bit_depth,
        b"data",
        data_size,
    )
    return header + pcm_bytes
