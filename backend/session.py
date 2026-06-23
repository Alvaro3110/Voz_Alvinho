"""
session.py — Session and connection lifecycle manager for the voice agent WebSocket.

Manages per-connection state including session_id, active tasks, and interruption signals.
"""

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Optional
from fastapi import WebSocket


@dataclass
class VoiceSession:
    """Per-connection session state."""
    session_id: str
    websocket: WebSocket
    # Active TTS/response streaming task — cancelled on interruption
    active_response_task: Optional[asyncio.Task] = None
    # Set to True when new audio arrives while response is playing
    interrupted: bool = False

    def is_response_active(self) -> bool:
        return (
            self.active_response_task is not None
            and not self.active_response_task.done()
        )

    async def interrupt(self) -> None:
        """Cancel any active response stream immediately."""
        self.interrupted = True
        if self.is_response_active():
            self.active_response_task.cancel()
            try:
                await self.active_response_task
            except asyncio.CancelledError:
                pass
        self.active_response_task = None
        self.interrupted = False

    async def send_json(self, data: dict) -> None:
        await self.websocket.send_json(data)

    async def send_bytes(self, data: bytes) -> None:
        await self.websocket.send_bytes(data)


class SessionManager:
    """Manages the lifecycle of all active WebSocket sessions."""

    def __init__(self) -> None:
        self._sessions: dict[str, VoiceSession] = {}

    def create_session(self, websocket: WebSocket) -> VoiceSession:
        session_id = str(uuid.uuid4())
        session = VoiceSession(session_id=session_id, websocket=websocket)
        self._sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[VoiceSession]:
        return self._sessions.get(session_id)

    async def close_session(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session and session.is_response_active():
            await session.interrupt()

    @property
    def active_count(self) -> int:
        return len(self._sessions)


# Singleton instance shared across the app
session_manager = SessionManager()
