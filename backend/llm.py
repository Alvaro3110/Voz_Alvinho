"""
llm.py — LLM streaming agent using OpenAI GPT-4o-mini.

Receives transcribed text and streams back sentence-grouped text chunks
suitable for real-time TTS synthesis.
"""

import os
import re
import logging
from typing import AsyncIterator
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None

SYSTEM_PROMPT = """Você é Alvinho, um assistente de voz inteligente que fala em português brasileiro.

Regras importantes:
- Responda SEMPRE em português do Brasil, de forma natural e conversacional.
- Seja direto e conciso — respostas curtas são melhores para voz (máximo 3 frases por vez).
- Evite usar listas, bullet points ou markdown — fale como uma pessoa real.
- Tom amigável, próximo e casual.
- Se não souber algo, admita honestamente de forma breve.
"""


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    return _client


async def stream_response(user_text: str, history: list[dict] | None = None) -> AsyncIterator[str]:
    """
    Stream LLM response as sentence-grouped text chunks.

    Each yielded chunk is a complete sentence (or short phrase) ready for TTS.
    Groups tokens by sentence boundaries (., !, ?, ;) or by max ~80 chars.

    Args:
        user_text: The transcribed user message.
        history: Optional list of previous messages [{"role": ..., "content": ...}].

    Yields:
        Sentence-sized text chunks ready to be passed to TTS.
    """
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history[-10:])  # Keep last 10 turns for context
    messages.append({"role": "user", "content": user_text})

    client = _get_client()
    buffer = ""

    try:
        stream = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            stream=True,
            temperature=0.7,
            max_tokens=300,
        )

        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            buffer += delta

            # Yield when we hit a sentence boundary
            while True:
                match = re.search(r"[.!?;]\s", buffer)
                if match or len(buffer) > 120:
                    split_at = match.end() if match else len(buffer)
                    sentence = buffer[:split_at].strip()
                    buffer = buffer[split_at:]
                    if sentence:
                        logger.debug(f"[LLM] Chunk: '{sentence[:60]}'")
                        yield sentence
                    if not match:
                        break
                else:
                    break

        # Yield any remaining buffer
        if buffer.strip():
            yield buffer.strip()

    except Exception as exc:
        logger.error(f"[LLM] Streaming error: {exc}")
        raise
