# Voz Alvinho 🎙️

Agente de voz em tempo real com pipeline completo de STT → LLM → TTS.

## Stack

- **Backend**: FastAPI + WebSocket (Python)
- **STT**: Groq Whisper large-v3-turbo (ultra-rápido, pt-BR)
- **LLM**: OpenAI GPT-4o-mini com streaming
- **TTS**: OpenAI TTS (tts-1, voz nova)
- **Frontend**: Next.js + Web Audio API + VAD (Silero)

## Estrutura

```
├── backend/          ← FastAPI voice agent server
│   ├── main.py       ← WebSocket endpoint + pipeline orchestration
│   ├── session.py    ← Session & connection lifecycle manager
│   ├── stt.py        ← Speech-to-Text (Groq Whisper)
│   ├── llm.py        ← LLM streaming agent (GPT-4o-mini)
│   ├── tts.py        ← Text-to-Speech (OpenAI TTS)
│   └── requirements.txt
└── frontend/         ← Next.js (em desenvolvimento)
```

## Como rodar (Backend)

```bash
cd backend
cp .env.example .env
# Preencha OPENAI_API_KEY e GROQ_API_KEY no .env

pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## WebSocket Protocol

**Endpoint:** `ws://localhost:8000/v1/ws/voice-agent`

### Cliente → Servidor
| Tipo | Formato | Descrição |
|------|---------|-----------|
| Áudio | `bytes` | PCM16 mono 16kHz (chunks do VAD) |
| Interrupção | `{"type": "interrupt"}` | Para resposta ativa imediatamente |

### Servidor → Cliente
| Tipo | Formato | Descrição |
|------|---------|-----------|
| Conectado | `{"type": "connected", "session_id": "..."}` | ID da sessão |
| Transcrição | `{"type": "transcript", "text": "..."}` | Resultado do STT |
| Texto | `{"type": "text_chunk", "text": "..."}` | Chunk de frase do LLM |
| Áudio | `bytes` | MP3 do TTS (chunk por frase) |
| Fim | `{"type": "response_end"}` | Fim da resposta completa |
| Interrompido | `{"type": "interrupted"}` | Confirmação de interrupção |
| Erro | `{"type": "error", "message": "..."}` | Erro no pipeline |

## Health Check

```
GET http://localhost:8000/health
```
