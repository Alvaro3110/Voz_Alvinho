"""
main.py — FastAPI entry point for the Voz Alvinho voice agent backend.

Exposes:
  GET  /health              → health check
  WS   /v1/ws/voice-agent  → bidirectional WebSocket for real-time voice

WebSocket protocol:
  Client → Server:
    - Binary frames: raw PCM16 mono 16kHz audio chunks (speech detected by VAD)
    - JSON {"type": "interrupt"}: client requesting immediate stop of current response

  Server → Client:
    - JSON {"type": "transcript", "text": "..."}: STT result
    - JSON {"type": "text_chunk", "text": "..."}: LLM sentence chunk (before TTS)
    - Binary frames: MP3 audio chunks (TTS output)
    - JSON {"type": "response_end"}: signals end of full AI response turn
    - JSON {"type": "error", "message": "..."}: error notification
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from session import session_manager, VoiceSession
import stt
import llm
import tts

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🎙️  Voz Alvinho backend starting up...")
    yield
    logger.info("🎙️  Voz Alvinho backend shutting down.")


app = FastAPI(
    title="Voz Alvinho — Voice Agent API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "active_sessions": session_manager.active_count,
    }


@app.websocket("/v1/ws/voice-agent")
async def voice_agent_ws(websocket: WebSocket) -> None:
    """
    Main WebSocket endpoint for the real-time voice agent.

    Lifecycle:
      1. Accept connection and create session.
      2. Receive messages (binary audio or JSON control).
      3. On binary audio: run STT → LLM → TTS pipeline, streaming audio back.
      4. On JSON interrupt: cancel active response immediately.
      5. On disconnect: cleanup session.
    """
    await websocket.accept()
    session = session_manager.create_session(websocket)
    logger.info(f"[WS] New session: {session.session_id}")

    # Per-session conversation history for context
    conversation_history: list[dict] = []

    try:
        await session.send_json({"type": "connected", "session_id": session.session_id})

        while True:
            # Receive next message (binary audio or JSON control)
            message = await websocket.receive()

            if "bytes" in message and message["bytes"]:
                # ── Binary audio frame: new speech detected by VAD ──
                audio_bytes: bytes = message["bytes"]
                logger.info(f"[WS] Received audio chunk: {len(audio_bytes)} bytes")

                # If a response is active, interrupt it first
                if session.is_response_active():
                    logger.info(f"[WS] Interrupting active response for {session.session_id}")
                    await session.interrupt()
                    await session.send_json({"type": "interrupted"})

                # Launch the full pipeline as a cancellable task
                session.active_response_task = asyncio.create_task(
                    _run_pipeline(session, audio_bytes, conversation_history)
                )

            elif "text" in message and message["text"]:
                # ── JSON control message ──
                import json
                try:
                    data = json.loads(message["text"])
                except Exception:
                    continue

                if data.get("type") == "interrupt":
                    if session.is_response_active():
                        await session.interrupt()
                        await session.send_json({"type": "interrupted"})

    except WebSocketDisconnect:
        logger.info(f"[WS] Session disconnected: {session.session_id}")
    except Exception as exc:
        logger.error(f"[WS] Unexpected error in session {session.session_id}: {exc}")
    finally:
        await session_manager.close_session(session.session_id)


async def _run_pipeline(
    session: VoiceSession,
    audio_bytes: bytes,
    conversation_history: list[dict],
) -> None:
    """
    Full pipeline: STT → LLM stream → TTS stream → send audio chunks.

    Designed to be run as an asyncio.Task so it can be cancelled on interruption.
    """
    try:
        # ── Step 1: STT ──
        logger.info(f"[Pipeline] STT start for session {session.session_id}")
        transcript = await stt.transcribe(audio_bytes)

        if not transcript:
            await session.send_json({"type": "error", "message": "Could not transcribe audio."})
            return

        await session.send_json({"type": "transcript", "text": transcript})
        logger.info(f"[Pipeline] Transcript: '{transcript}'")

        # Add user turn to history
        conversation_history.append({"role": "user", "content": transcript})
        assistant_reply_parts: list[str] = []

        # ── Step 2: LLM streaming → Step 3: TTS per sentence ──
        async for text_chunk in llm.stream_response(transcript, conversation_history):
            # Check cancellation point
            await asyncio.sleep(0)

            await session.send_json({"type": "text_chunk", "text": text_chunk})
            assistant_reply_parts.append(text_chunk)

            # Synthesize this sentence and stream audio immediately
            audio_chunk = await tts.synthesize(text_chunk)
            if audio_chunk:
                await session.send_bytes(audio_chunk)

        # ── Step 4: Signal end of response ──
        await session.send_json({"type": "response_end"})

        # Persist assistant reply in history
        full_reply = " ".join(assistant_reply_parts)
        conversation_history.append({"role": "assistant", "content": full_reply})

        # Keep history bounded (last 20 turns = 10 exchanges)
        if len(conversation_history) > 20:
            conversation_history[:] = conversation_history[-20:]

    except asyncio.CancelledError:
        logger.info(f"[Pipeline] Cancelled for session {session.session_id}")
        raise
    except Exception as exc:
        logger.error(f"[Pipeline] Error: {exc}")
        try:
            await session.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
