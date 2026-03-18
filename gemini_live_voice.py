#!/usr/bin/env python3
"""
Gemini Live full-duplex voice runtime for continuous, interruptible conversations.

Requirements:
  - GEMINI_API_KEY in env (or pass --api-key)
  - GROQ_API_KEY in env for preview/overview helpers (or pass --groq-api-key)
  - pip install google-genai groq pyaudio
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import io
import math
import os
import signal
import sys
import time
import wave
from array import array
from collections import deque
from dataclasses import dataclass
from typing import Any, Deque, Iterable, Optional

try:
    import pyaudio
except Exception:  # pragma: no cover - runtime dependency guard
    pyaudio = None
try:
    from google import genai
    from google.genai import types
except Exception:  # pragma: no cover - runtime dependency guard
    genai = None
    types = None
try:
    from groq import Groq
except Exception:  # pragma: no cover - runtime dependency guard
    Groq = None


DEFAULT_MODEL_CANDIDATES = (
    "gemini-live-2.5-flash-native-audio",
    "gemini-2.5-flash-native-audio-preview-12-2025",
    "gemini-2.5-flash-native-audio-preview-09-2025",
)

DEFAULT_SYSTEM_PROMPT = (
    "You are AutoLearn, a hands-free learning expert. "
    "Speak naturally, warmly, and clearly at a calm pace. "
    "Use short sentences and clear pauses between ideas. "
    "Keep each response to 1 short sentence unless the host asks for depth. "
    "After each response, pause to listen. "
    "If interrupted, gracefully adapt immediately. "
    "Default to conversational English and never lecture about language policy."
)
DEFAULT_GROQ_CHAT_MODEL = "llama-3.3-70b-versatile"
DEFAULT_GROQ_TTS_MODEL = "playai-tts"
DEFAULT_GROQ_TTS_VOICE = "Fritz-PlayAI"


@dataclass(slots=True)
class AudioSettings:
    mic_rate: int = 16000
    speaker_rate: int = 24000
    channels: int = 1
    chunk_size: int = 320  # 20 ms at 16kHz
    format: int = 8  # PyAudio paInt16


@dataclass(slots=True)
class EchoGateSettings:
    enabled: bool = True
    output_hold_ms: int = 210
    barge_min_rms: int = 360
    barge_multiplier: float = 1.9
    noise_alpha: float = 0.03
    output_follow_ratio: float = 1.35
    output_follow_delta: float = 90.0
    interrupt_cooldown_ms: int = 450


@dataclass(slots=True)
class LocalVADSettings:
    explicit_signals: bool = True
    start_rms: int = 170
    end_rms: int = 110
    start_chunks: int = 3
    barge_start_chunks: int = 8
    end_chunks: int = 16
    preroll_chunks: int = 8
    idle_end_ms: int = 700


def _unique_nonempty(values: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        clean = (value or "").strip()
        if not clean or clean in seen:
            continue
        seen.add(clean)
        out.append(clean)
    return out


def _is_model_not_found_error(err: BaseException) -> bool:
    msg = str(err).lower()
    return (
        "404" in msg
        or ("not found" in msg and "model" in msg)
        or "unsupported model" in msg
        or "unknown model" in msg
    )


def _short_err(err: BaseException) -> str:
    return str(err).strip() or err.__class__.__name__


def _is_transient_probe_error(err: BaseException) -> bool:
    msg = _short_err(err).lower()
    transient_markers = (
        "no close frame received or sent",
        "connection closed",
        "connection reset",
        "eof",
        "timed out",
        "timeout",
        "temporarily unavailable",
        "try again",
        "503",
        "502",
        "504",
        "transport",
        "websocket",
        "network",
    )
    return any(marker in msg for marker in transient_markers)


def _is_unknown_setup_field_error(err: BaseException) -> bool:
    msg = _short_err(err).lower()
    return (
        "invalid json payload received" in msg
        and "unknown name" in msg
        and "setup" in msg
    )


def _is_explicit_vad_unsupported_error(err: BaseException) -> bool:
    msg = _short_err(err).lower()
    return (
        "explicit_vad_signal" in msg
        and "not supported" in msg
    ) or ("explicitvadsignal" in msg and "not supported" in msg)


def _normalize_language_code(language: str) -> str:
    clean = (language or "").strip()
    if not clean:
        return "en-US"
    lower = clean.lower()
    if lower in {"english", "en", "en-us", "en_us", "english (us)", "english us"}:
        return "en-US"
    if lower in {"english (uk)", "english uk", "en-gb", "en_gb"}:
        return "en-GB"
    # If caller provided a BCP-47-ish code, keep it.
    if "-" in clean and len(clean) >= 4:
        return clean
    if len(clean) == 2:
        return f"{clean.lower()}-{clean.upper()}"
    return clean


def _resolve_activity_handling(allow_barge_in: bool) -> Any:
    if types is None:
        return None
    if allow_barge_in:
        return getattr(types.ActivityHandling, "START_OF_ACTIVITY_INTERRUPTS", None)
    return (
        getattr(types.ActivityHandling, "NO_INTERRUPTION", None)
        or getattr(types.ActivityHandling, "ACTIVITY_HANDLING_UNSPECIFIED", None)
        or getattr(types.ActivityHandling, "START_OF_ACTIVITY_INTERRUPTS", None)
    )


def _resolve_turn_coverage() -> Any:
    if types is None:
        return None
    return (
        getattr(types.TurnCoverage, "TURN_INCLUDES_ONLY_ACTIVITY", None)
        or getattr(types.TurnCoverage, "TURN_COVERAGE_UNSPECIFIED", None)
    )


def _print_audio_devices() -> int:
    if pyaudio is None:
        print("PyAudio is not installed. Install with: pip install pyaudio", file=sys.stderr)
        return 2
    pa = pyaudio.PyAudio()
    try:
        default_in = None
        default_out = None
        with contextlib.suppress(Exception):
            default_in = pa.get_default_input_device_info().get("index")
        with contextlib.suppress(Exception):
            default_out = pa.get_default_output_device_info().get("index")
        print("Audio devices:")
        for i in range(pa.get_device_count()):
            info = pa.get_device_info_by_index(i)
            in_ch = int(info.get("maxInputChannels", 0) or 0)
            out_ch = int(info.get("maxOutputChannels", 0) or 0)
            if in_ch <= 0 and out_ch <= 0:
                continue
            role = []
            if i == default_in:
                role.append("default-input")
            if i == default_out:
                role.append("default-output")
            role_text = f" ({', '.join(role)})" if role else ""
            print(
                f"  [{i}] {info.get('name', 'unknown')} "
                f"in={in_ch} out={out_ch}{role_text}"
            )
        return 0
    finally:
        with contextlib.suppress(Exception):
            pa.terminate()


class GeminiLiveVoiceRuntime:
    def __init__(
        self,
        *,
        api_key: str,
        model_candidates: list[str],
        voice_name: str,
        language_code: str,
        system_prompt: str,
        audio: AudioSettings,
        echo_gate: EchoGateSettings,
        vad: LocalVADSettings,
        allow_barge_in: bool,
        input_device_index: Optional[int],
        output_device_index: Optional[int],
        mic_gain: float,
        speaker_gain: float,
        max_output_tokens: int,
        print_input_transcript: bool,
        hello_loops: int,
        hello_only: bool,
        skip_hello_test: bool,
        enable_affective_dialog: bool,
    ) -> None:
        self.api_key = api_key
        self.model_candidates = model_candidates
        self.voice_name = voice_name
        self.language_code = language_code
        self.system_prompt = system_prompt
        self.audio = audio
        self.echo_gate = echo_gate
        self.vad = vad
        self.allow_barge_in = bool(allow_barge_in)
        self.input_device_index = input_device_index
        self.output_device_index = output_device_index
        self.mic_gain = max(0.5, min(3.0, float(mic_gain)))
        self.speaker_gain = max(0.1, min(1.5, float(speaker_gain)))
        self.max_output_tokens = max(64, min(1024, int(max_output_tokens)))
        self.print_input_transcript = bool(print_input_transcript)
        self.hello_loops = max(1, hello_loops)
        self.hello_only = hello_only
        self.skip_hello_test = skip_hello_test
        self.enable_affective_dialog = enable_affective_dialog

        if pyaudio is None:
            raise RuntimeError("Missing dependency 'pyaudio'. Install with: pip install pyaudio")
        if genai is None or types is None:
            raise RuntimeError("Missing dependency 'google-genai'. Install with: pip install google-genai")

        http_options = {"api_version": "v1alpha"} if enable_affective_dialog else {"api_version": "v1beta"}
        self.client = genai.Client(api_key=api_key, http_options=http_options)
        self.pya = pyaudio.PyAudio()

        self.stop_event = asyncio.Event()
        self.reconnect_event = asyncio.Event()
        self.resume_handle: Optional[str] = None
        self.model: Optional[str] = None

        self.mic_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=20)
        self.playback_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=96)
        self.history_window: Deque[str] = deque(maxlen=40)

        self._input_stream: Any = None
        self._output_stream: Any = None
        self._last_input_transcript: str = ""
        self._last_output_transcript: str = ""
        self._last_token_report: int = 0
        self._noise_floor_rms: float = 140.0
        self._speaker_output_rms: float = 0.0
        self._ai_output_hold_until: float = 0.0
        self._ai_output_started_at: float = 0.0
        self._gate_filtered_chunks: int = 0
        self._gate_last_report_at: float = 0.0
        self._interrupt_cooldown_until: float = 0.0
        self._force_minimal_setup: bool = False
        self._force_server_vad: bool = not bool(self.vad.explicit_signals)
        self._explicit_vad_active: bool = bool(self.vad.explicit_signals) and not self._force_server_vad

    def request_stop(self) -> None:
        self.stop_event.set()
        self.reconnect_event.set()

    async def close(self) -> None:
        await self._close_input_stream()
        await self._close_output_stream()
        await asyncio.to_thread(self.pya.terminate)

    def _base_live_config(self) -> Any:
        if self._force_minimal_setup:
            self._explicit_vad_active = False
            return types.LiveConnectConfig(
                responseModalities=[types.Modality.AUDIO],
                temperature=0.35,
                maxOutputTokens=self.max_output_tokens,
                systemInstruction=self.system_prompt,
                speechConfig=types.SpeechConfig(
                    voiceConfig=types.VoiceConfig(
                        prebuiltVoiceConfig=types.PrebuiltVoiceConfig(voiceName=self.voice_name)
                    ),
                    languageCode=self.language_code,
                ),
            )

        use_explicit_vad = bool(self.vad.explicit_signals) and not self._force_server_vad
        activity_handling = _resolve_activity_handling(self.allow_barge_in)
        turn_coverage = _resolve_turn_coverage()
        if use_explicit_vad:
            realtime_kwargs: dict[str, Any] = {
                "automaticActivityDetection": types.AutomaticActivityDetection(disabled=True),
            }
            if activity_handling is not None:
                realtime_kwargs["activityHandling"] = activity_handling
            if turn_coverage is not None:
                realtime_kwargs["turnCoverage"] = turn_coverage
            realtime_input = types.RealtimeInputConfig(**realtime_kwargs)
            explicit_vad_signal = True
        else:
            realtime_kwargs = {
                "automaticActivityDetection": types.AutomaticActivityDetection(
                    disabled=False,
                    startOfSpeechSensitivity=types.StartSensitivity.START_SENSITIVITY_LOW,
                    endOfSpeechSensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
                    prefixPaddingMs=220,
                    silenceDurationMs=700,
                ),
            }
            if activity_handling is not None:
                realtime_kwargs["activityHandling"] = activity_handling
            if turn_coverage is not None:
                realtime_kwargs["turnCoverage"] = turn_coverage
            realtime_input = types.RealtimeInputConfig(**realtime_kwargs)
            explicit_vad_signal = False
        self._explicit_vad_active = explicit_vad_signal

        session_resumption = types.SessionResumptionConfig(handle=self.resume_handle) if self.resume_handle else types.SessionResumptionConfig()

        config_kwargs: dict[str, Any] = {
            "responseModalities": [types.Modality.AUDIO],
            "temperature": 0.25,
            "maxOutputTokens": self.max_output_tokens,
            "systemInstruction": self.system_prompt,
            "speechConfig": types.SpeechConfig(
                voiceConfig=types.VoiceConfig(
                    prebuiltVoiceConfig=types.PrebuiltVoiceConfig(voiceName=self.voice_name)
                ),
                languageCode=self.language_code,
            ),
            "sessionResumption": session_resumption,
            "inputAudioTranscription": types.AudioTranscriptionConfig(),
            "outputAudioTranscription": types.AudioTranscriptionConfig(),
            "realtimeInputConfig": realtime_input,
            "contextWindowCompression": types.ContextWindowCompressionConfig(
                slidingWindow=types.SlidingWindow()
            ),
        }
        config = types.LiveConnectConfig(**config_kwargs)
        if self.enable_affective_dialog:
            config.enableAffectiveDialog = True
        return config

    @staticmethod
    def _drain_queue(queue: asyncio.Queue[Any]) -> int:
        count = 0
        while True:
            try:
                queue.get_nowait()
                count += 1
            except asyncio.QueueEmpty:
                return count

    @staticmethod
    def _put_drop_oldest(queue: asyncio.Queue[bytes], chunk: bytes) -> None:
        try:
            queue.put_nowait(chunk)
            return
        except asyncio.QueueFull:
            pass

        with contextlib.suppress(asyncio.QueueEmpty):
            queue.get_nowait()
        with contextlib.suppress(asyncio.QueueFull):
            queue.put_nowait(chunk)

    @staticmethod
    def _rms_pcm16(data: bytes) -> float:
        if not data:
            return 0.0
        if len(data) < 2:
            return 0.0
        with contextlib.suppress(Exception):
            samples = memoryview(data).cast("h")
            if len(samples) == 0:
                return 0.0
            acc = 0.0
            for sample in samples:
                s = float(sample)
                acc += s * s
            return math.sqrt(acc / len(samples))
        return 0.0

    @staticmethod
    def _apply_gain_pcm16(data: bytes, gain: float) -> bytes:
        if not data or gain == 1.0:
            return data
        with contextlib.suppress(Exception):
            samples = array("h")
            samples.frombytes(data)
            for i, sample in enumerate(samples):
                scaled = int(sample * gain)
                if scaled > 32767:
                    scaled = 32767
                elif scaled < -32768:
                    scaled = -32768
                samples[i] = scaled
            return samples.tobytes()
        return data

    def _is_ai_output_recent(self) -> bool:
        return time.monotonic() < self._ai_output_hold_until

    def _mark_ai_output_activity(self) -> None:
        hold_seconds = max(0.05, self.echo_gate.output_hold_ms / 1000.0)
        now = time.monotonic()
        if now >= self._ai_output_hold_until:
            self._ai_output_started_at = now
            if self.allow_barge_in:
                # New AI speech burst: discard stale host audio to avoid immediate self-interrupt loops.
                self._drain_queue(self.mic_queue)
                self._interrupt_cooldown_until = max(self._interrupt_cooldown_until, now + 0.18)
        self._ai_output_hold_until = max(self._ai_output_hold_until, time.monotonic() + hold_seconds)

    @staticmethod
    def _is_low_signal_transcript(text: str) -> bool:
        cleaned = text.strip().lower()
        if not cleaned:
            return True
        if cleaned.startswith("<noise>") or cleaned.startswith("[noise]"):
            return True
        if len(cleaned) <= 1:
            return True
        return False

    def _update_noise_floor(self, rms: float) -> None:
        alpha = max(0.005, min(0.3, self.echo_gate.noise_alpha))
        if rms <= 0:
            return
        # Track low-end ambient floor, but do not let spikes dominate adaptation.
        if rms < self._noise_floor_rms * 1.8:
            self._noise_floor_rms = ((1.0 - alpha) * self._noise_floor_rms) + (alpha * rms)

    def _current_barge_threshold(self) -> float:
        return max(
            float(self.echo_gate.barge_min_rms),
            self._noise_floor_rms * max(1.2, self.echo_gate.barge_multiplier),
        )

    def _current_start_threshold(self, during_ai_output: bool) -> float:
        if during_ai_output and self.echo_gate.enabled:
            threshold = self._current_barge_threshold()
            if self._speaker_output_rms > 0:
                follow_threshold = (
                    self._speaker_output_rms * max(1.1, self.echo_gate.output_follow_ratio)
                ) + max(0.0, self.echo_gate.output_follow_delta)
                threshold = max(threshold, follow_threshold)
            # Startup echo burst guard: first few hundred ms of AI output is most echo-prone.
            if self._ai_output_started_at > 0 and (time.monotonic() - self._ai_output_started_at) < 0.80:
                threshold *= 1.45
            return threshold
        ambient_start = self._noise_floor_rms * 1.18
        return max(float(self.vad.start_rms), ambient_start)

    def _current_end_threshold(self) -> float:
        ambient_end = self._noise_floor_rms * 1.02
        return max(float(self.vad.end_rms), ambient_end)

    async def _open_input_stream(self) -> None:
        if self._input_stream is not None:
            return

        input_device_index = self.input_device_index
        if input_device_index is None:
            with contextlib.suppress(Exception):
                mic_info = self.pya.get_default_input_device_info()
                input_device_index = mic_info.get("index")

        self._input_stream = await asyncio.to_thread(
            self.pya.open,
            format=self.audio.format,
            channels=self.audio.channels,
            rate=self.audio.mic_rate,
            input=True,
            input_device_index=input_device_index,
            frames_per_buffer=self.audio.chunk_size,
        )

    async def _close_input_stream(self) -> None:
        if self._input_stream is None:
            return
        stream = self._input_stream
        self._input_stream = None
        with contextlib.suppress(Exception):
            await asyncio.to_thread(stream.stop_stream)
        with contextlib.suppress(Exception):
            await asyncio.to_thread(stream.close)

    async def _open_output_stream(self) -> None:
        if self._output_stream is not None:
            return
        output_device_index = self.output_device_index
        if output_device_index is None:
            with contextlib.suppress(Exception):
                speaker_info = self.pya.get_default_output_device_info()
                output_device_index = speaker_info.get("index")
        self._output_stream = await asyncio.to_thread(
            self.pya.open,
            format=self.audio.format,
            channels=self.audio.channels,
            rate=self.audio.speaker_rate,
            output=True,
            output_device_index=output_device_index,
            frames_per_buffer=self.audio.chunk_size,
        )

    async def _close_output_stream(self) -> None:
        if self._output_stream is None:
            return
        stream = self._output_stream
        self._output_stream = None
        with contextlib.suppress(Exception):
            await asyncio.to_thread(stream.stop_stream)
        with contextlib.suppress(Exception):
            await asyncio.to_thread(stream.close)

    async def _capture_mic(self) -> None:
        await self._open_input_stream()
        kwargs = {"exception_on_overflow": False}
        while not self.stop_event.is_set() and not self.reconnect_event.is_set():
            data = await asyncio.to_thread(self._input_stream.read, self.audio.chunk_size, **kwargs)
            if data:
                self._put_drop_oldest(self.mic_queue, data)

    async def _send_mic_audio(self, session: Any) -> None:
        mime_type = f"audio/pcm;rate={self.audio.mic_rate}"
        if not self._explicit_vad_active:
            # Simple/stable path: continuously stream mic audio and let server VAD segment turns.
            while not self.stop_event.is_set() and not self.reconnect_event.is_set():
                try:
                    chunk = await asyncio.wait_for(self.mic_queue.get(), timeout=0.35)
                except asyncio.TimeoutError:
                    continue
                if self.mic_gain != 1.0:
                    chunk = self._apply_gain_pcm16(chunk, self.mic_gain)
                await session.send_realtime_input(audio=types.Blob(data=chunk, mime_type=mime_type))
            return

        activity_active = False
        start_hits = 0
        end_hits = 0
        last_sent_audio_at = 0.0
        pre_roll: Deque[bytes] = deque(maxlen=max(1, int(self.vad.preroll_chunks)))
        barge_start_chunks = max(int(self.vad.barge_start_chunks), int(self.vad.start_chunks) + 3)
        normal_start_chunks = max(1, int(self.vad.start_chunks))
        end_needed = max(4, int(self.vad.end_chunks))

        while not self.stop_event.is_set() and not self.reconnect_event.is_set():
            try:
                chunk = await asyncio.wait_for(self.mic_queue.get(), timeout=0.35)
            except asyncio.TimeoutError:
                if activity_active and (time.monotonic() - last_sent_audio_at) * 1000.0 >= float(self.vad.idle_end_ms):
                    if self._explicit_vad_active:
                        with contextlib.suppress(Exception):
                            await session.send_realtime_input(activity_end=types.ActivityEnd())
                    else:
                        with contextlib.suppress(Exception):
                            await session.send_realtime_input(audio_stream_end=True)
                    activity_active = False
                    start_hits = 0
                    end_hits = 0
                    pre_roll.clear()
                continue

            if self.mic_gain != 1.0:
                chunk = self._apply_gain_pcm16(chunk, self.mic_gain)
            ai_recent = self._is_ai_output_recent()
            rms = self._rms_pcm16(chunk)
            if not ai_recent:
                self._update_noise_floor(rms)
            start_threshold = self._current_start_threshold(during_ai_output=ai_recent)
            end_threshold = self._current_end_threshold()
            pre_roll.append(chunk)

            if not activity_active:
                now = time.monotonic()
                if now < self._interrupt_cooldown_until:
                    start_hits = 0
                    continue
                if rms >= start_threshold:
                    start_hits += 1
                else:
                    start_hits = max(0, start_hits - 1)
                    if ai_recent and self.echo_gate.enabled:
                        self._gate_filtered_chunks += 1
                        now = time.monotonic()
                        if now - self._gate_last_report_at >= 3.0:
                            print(
                                f"\n[echo-gate] suppressing low-level audio while AI speaks "
                                f"(rms={rms:.0f}, threshold={start_threshold:.0f}, floor={self._noise_floor_rms:.0f})"
                            )
                            self._gate_last_report_at = now

                needed = barge_start_chunks if ai_recent else normal_start_chunks
                if start_hits < needed:
                    continue

                if self._explicit_vad_active:
                    with contextlib.suppress(Exception):
                        await session.send_realtime_input(activity_start=types.ActivityStart())
                activity_active = True
                start_hits = 0
                end_hits = 0

                while pre_roll:
                    buffered = pre_roll.popleft()
                    await session.send_realtime_input(
                        audio=types.Blob(data=buffered, mime_type=mime_type)
                    )
                    last_sent_audio_at = time.monotonic()
                continue

            await session.send_realtime_input(audio=types.Blob(data=chunk, mime_type=mime_type))
            last_sent_audio_at = time.monotonic()

            if rms <= end_threshold:
                end_hits += 1
            else:
                end_hits = 0

            if end_hits < end_needed:
                continue

            if self._explicit_vad_active:
                with contextlib.suppress(Exception):
                    await session.send_realtime_input(activity_end=types.ActivityEnd())
            else:
                with contextlib.suppress(Exception):
                    await session.send_realtime_input(audio_stream_end=True)
            activity_active = False
            start_hits = 0
            end_hits = 0
            pre_roll.clear()

    async def _play_audio(self) -> None:
        await self._open_output_stream()

        while not self.stop_event.is_set() and not self.reconnect_event.is_set():
            try:
                chunk = await asyncio.wait_for(self.playback_queue.get(), timeout=0.2)
            except asyncio.TimeoutError:
                continue
            chunk_rms = self._rms_pcm16(chunk)
            if chunk_rms > 0:
                self._speaker_output_rms = (self._speaker_output_rms * 0.86) + (chunk_rms * 0.14)
            self._mark_ai_output_activity()
            if self.speaker_gain != 1.0:
                chunk = self._apply_gain_pcm16(chunk, self.speaker_gain)
            await asyncio.to_thread(self._output_stream.write, chunk)

    async def _handle_server_message(self, message: Any) -> None:
        update = getattr(message, "session_resumption_update", None)
        if update and getattr(update, "resumable", False) and getattr(update, "new_handle", None):
            self.resume_handle = update.new_handle

        go_away = getattr(message, "go_away", None)
        if go_away is not None:
            time_left = getattr(go_away, "time_left", None)
            print(f"\n[live] server requested reconnect (time_left={time_left}).")
            self.reconnect_event.set()

        usage = getattr(message, "usage_metadata", None)
        if usage is not None:
            total = int(getattr(usage, "total_token_count", 0) or 0)
            if total and total - self._last_token_report >= 4000:
                self._last_token_report = total
                print(f"\n[live] token usage: {total}")

        server = getattr(message, "server_content", None)
        if not server:
            return

        if getattr(server, "interrupted", False):
            dropped = self._drain_queue(self.playback_queue)
            drained_mic = 0
            if self.allow_barge_in:
                drained_mic = self._drain_queue(self.mic_queue)
                self._interrupt_cooldown_until = max(
                    self._interrupt_cooldown_until,
                    time.monotonic() + (max(120, int(self.echo_gate.interrupt_cooldown_ms)) / 1000.0),
                )
            self._ai_output_hold_until = 0.0
            self._ai_output_started_at = 0.0
            if self.allow_barge_in:
                if dropped:
                    print(
                        f"\n[barge-in] interrupted, dropped {dropped} queued audio chunks "
                        f"(cleared {drained_mic} mic chunks)."
                    )
                    if dropped >= 40:
                        print(
                            "[barge-in] high drop count suggests speaker feedback. "
                            "Try lower speaker gain or higher barge threshold."
                        )
                else:
                    print("\n[barge-in] interrupted.")

        input_tx = getattr(server, "input_transcription", None)
        if input_tx and getattr(input_tx, "text", None):
            text = input_tx.text.strip()
            if text and text != self._last_input_transcript:
                if (
                    self.print_input_transcript
                    and not self._is_low_signal_transcript(text)
                    and not text.startswith(self._last_input_transcript)
                ):
                    print(f"\nHost: {text}")
                self._last_input_transcript = text
                self.history_window.append(f"Host: {text}")

        output_tx = getattr(server, "output_transcription", None)
        if output_tx and getattr(output_tx, "text", None):
            text = output_tx.text.strip()
            if text and text != self._last_output_transcript:
                if not text.startswith(self._last_output_transcript):
                    print(f"\nAI: {text}")
                self._last_output_transcript = text
                self.history_window.append(f"AI: {text}")

        model_turn = getattr(server, "model_turn", None)
        if model_turn and getattr(model_turn, "parts", None):
            for part in model_turn.parts:
                inline_data = getattr(part, "inline_data", None)
                data = getattr(inline_data, "data", None) if inline_data else None
                if isinstance(data, (bytes, bytearray)) and data:
                    self._mark_ai_output_activity()
                    self._put_drop_oldest(self.playback_queue, bytes(data))

    async def _receive_stream(self, session: Any) -> None:
        while not self.stop_event.is_set() and not self.reconnect_event.is_set():
            turn = session.receive()
            async for message in turn:
                await self._handle_server_message(message)
                if self.stop_event.is_set() or self.reconnect_event.is_set():
                    break
            if self.stop_event.is_set() or self.reconnect_event.is_set():
                break

        if not self.stop_event.is_set():
            self.reconnect_event.set()

    async def _run_connection(self, model: str) -> float:
        self.reconnect_event.clear()
        self._drain_queue(self.mic_queue)
        self._drain_queue(self.playback_queue)
        self._last_input_transcript = ""
        self._last_output_transcript = ""
        self._ai_output_hold_until = 0.0
        self._ai_output_started_at = 0.0
        self._gate_filtered_chunks = 0
        self._gate_last_report_at = 0.0
        self._speaker_output_rms = 0.0
        self._interrupt_cooldown_until = 0.0
        config = self._base_live_config()

        print(f"\n[live] connecting with model: {model}")
        started = time.monotonic()

        async with self.client.aio.live.connect(model=model, config=config) as session:
            barge_mode = "enabled" if self.allow_barge_in else "disabled (stable mode)"
            print(f"[live] connected. Speak anytime; interruption is {barge_mode}.")
            if self._explicit_vad_active and self.echo_gate.enabled:
                print(
                    "[echo-gate] enabled "
                    f"(min_rms={self.echo_gate.barge_min_rms}, "
                    f"multiplier={self.echo_gate.barge_multiplier:.2f}, "
                    f"hold_ms={self.echo_gate.output_hold_ms}, "
                    f"mic_gain={self.mic_gain:.2f}, speaker_gain={self.speaker_gain:.2f})"
                )
            print(
                "[audio-devices] "
                f"input={self.input_device_index if self.input_device_index is not None else 'default'}, "
                f"output={self.output_device_index if self.output_device_index is not None else 'default'}"
            )
            print(
                "[vad] "
                + (
                    f"explicit client activity signals (start_rms={self.vad.start_rms}, end_rms={self.vad.end_rms})"
                    if self._explicit_vad_active
                    else "server automatic activity detection"
                )
            )
            if self._force_server_vad and self.vad.explicit_signals:
                print("[compat] forced server VAD mode due to API compatibility.")
            if self._force_minimal_setup:
                print("[compat] minimal setup mode active.")
            tasks = [
                asyncio.create_task(self._capture_mic()),
                asyncio.create_task(self._send_mic_audio(session)),
                asyncio.create_task(self._receive_stream(session)),
                asyncio.create_task(self._play_audio()),
            ]

            failure: Optional[BaseException] = None
            try:
                while not self.stop_event.is_set() and not self.reconnect_event.is_set():
                    await asyncio.sleep(0.1)
                    for task in tasks:
                        if not task.done():
                            continue
                        err = task.exception()
                        if err and not isinstance(err, asyncio.CancelledError):
                            failure = err
                            self.reconnect_event.set()
                            break
                    if failure:
                        break
            finally:
                for task in tasks:
                    task.cancel()
                results = await asyncio.gather(*tasks, return_exceptions=True)
                if not failure:
                    for result in results:
                        if isinstance(result, BaseException) and not isinstance(result, asyncio.CancelledError):
                            failure = result
                            break

            if failure and not self.stop_event.is_set():
                raise RuntimeError(_short_err(failure))

        ended = time.monotonic()
        return max(0.0, ended - started)

    async def _probe_model(self, model: str) -> None:
        config = self._base_live_config()
        async with self.client.aio.live.connect(model=model, config=config):
            return

    async def _consume_hello_turn(self, session: Any) -> tuple[bool, str]:
        got_audio = False
        transcript = ""

        turn = session.receive()
        async for message in turn:
            text_direct = getattr(message, "text", None)
            if isinstance(text_direct, str) and text_direct.strip():
                transcript = text_direct.strip()

            server = getattr(message, "server_content", None)
            if server:
                output_tx = getattr(server, "output_transcription", None)
                if output_tx and getattr(output_tx, "text", None):
                    transcript = output_tx.text.strip() or transcript

                model_turn = getattr(server, "model_turn", None)
                if model_turn and getattr(model_turn, "parts", None):
                    for part in model_turn.parts:
                        inline_data = getattr(part, "inline_data", None)
                        data = getattr(inline_data, "data", None) if inline_data else None
                        if isinstance(data, (bytes, bytearray)) and data:
                            got_audio = True

                if getattr(server, "turn_complete", False):
                    break

        return got_audio, transcript

    async def hello_smoke_test(self, model: str) -> None:
        config = self._base_live_config()
        print(f"[hello-test] running {self.hello_loops} loop(s) on {model}...")
        async with self.client.aio.live.connect(model=model, config=config) as session:
            for i in range(self.hello_loops):
                text = "hello"
                await session.send_client_content(
                    turns={"role": "user", "parts": [{"text": text}]},
                    turn_complete=True,
                )
                got_audio, transcript = await asyncio.wait_for(
                    self._consume_hello_turn(session),
                    timeout=20.0,
                )
                if not got_audio and not transcript:
                    raise RuntimeError("hello-test received no model output")
                spoken = transcript if transcript else "(audio received)"
                print(f"[hello-test] #{i + 1} ok: {spoken}")

    async def resolve_model(self) -> str:
        last_transient = ""
        for model in self.model_candidates:
            transient_failures = 0
            for attempt in range(4):
                try:
                    await self._probe_model(model)
                    print(f"[model] available: {model}")
                    if self._force_minimal_setup:
                        print("[compat] using minimal setup fields for server compatibility.")
                    return model
                except Exception as err:
                    msg = _short_err(err)
                    if _is_explicit_vad_unsupported_error(err):
                        if not self._force_server_vad:
                            self._force_server_vad = True
                            self._force_minimal_setup = False
                            print(
                                "[compat] explicit VAD is unsupported by this endpoint; "
                                "retrying with server VAD."
                            )
                            continue
                        print(f"[compat] explicit VAD unsupported persists: {msg}")
                        break
                    if _is_model_not_found_error(err):
                        print(f"[model] unavailable: {model}")
                        transient_failures = 0
                        break
                    if _is_unknown_setup_field_error(err):
                        if not self._force_minimal_setup:
                            self._force_minimal_setup = True
                            print(
                                "[compat] server rejected one or more optional setup fields; "
                                "retrying with minimal setup."
                            )
                            continue
                        print(f"[compat] setup field error persisted on minimal setup: {msg}")
                        break
                    if _is_transient_probe_error(err):
                        transient_failures += 1
                        last_transient = msg
                        if transient_failures < 3:
                            delay = 0.7 * transient_failures
                            print(
                                f"[model] transient probe issue on {model}: {msg} "
                                f"(retrying in {delay:.1f}s)"
                            )
                            await asyncio.sleep(delay)
                            continue
                        print(f"[model] skipping {model} after transient probe failures: {msg}")
                        break
                    raise RuntimeError(f"model probe failed for {model}: {msg}") from err

        if last_transient:
            raise RuntimeError(
                "no compatible model could be confirmed due to connection instability. "
                f"Last error: {last_transient}"
            )
        raise RuntimeError("no compatible Gemini Live native-audio model found")

    async def run(self) -> None:
        self.model = await self.resolve_model()

        if not self.skip_hello_test:
            await self.hello_smoke_test(self.model)
        elif self.hello_only:
            print("--hello-only requires hello test enabled.")
            return

        if self.hello_only:
            print("[hello-test] complete.")
            return

        backoff_seconds = 1.0
        while not self.stop_event.is_set():
            try:
                lifetime = await self._run_connection(self.model)
                if self.stop_event.is_set():
                    break
                if lifetime >= 20:
                    backoff_seconds = 1.0
                else:
                    backoff_seconds = min(backoff_seconds * 2.0, 15.0)
            except Exception as err:
                if self.stop_event.is_set():
                    break
                if _is_explicit_vad_unsupported_error(err) and not self._force_server_vad:
                    self._force_server_vad = True
                    self._force_minimal_setup = False
                    print(
                        "[compat] explicit VAD not supported during connect; "
                        "switching to server VAD and retrying."
                    )
                    backoff_seconds = 0.6
                    continue
                if _is_unknown_setup_field_error(err) and not self._force_minimal_setup:
                    self._force_minimal_setup = True
                    print(
                        "[compat] setup field mismatch detected during connect; "
                        "switching to minimal setup and retrying."
                    )
                    backoff_seconds = 0.6
                    continue
                print(f"[live] connection error: {_short_err(err)}")
                backoff_seconds = min(backoff_seconds * 2.0, 15.0)

            if self.stop_event.is_set():
                break

            print(f"[live] reconnecting in {backoff_seconds:.1f}s...")
            await asyncio.sleep(backoff_seconds)


def _resolve_groq_api_key(explicit_key: Optional[str]) -> str:
    key = (explicit_key or os.getenv("GROQ_API_KEY", "")).strip()
    if key:
        return key
    raise RuntimeError("Missing Groq API key. Set GROQ_API_KEY or pass --groq-api-key.")


def _require_groq_client(explicit_key: Optional[str]) -> Any:
    if Groq is None:
        raise RuntimeError("Missing dependency 'groq'. Install with: pip install groq")
    key = _resolve_groq_api_key(explicit_key)
    return Groq(api_key=key)


def _coerce_audio_bytes(payload: Any) -> bytes:
    if isinstance(payload, (bytes, bytearray)):
        return bytes(payload)
    read = getattr(payload, "read", None)
    if callable(read):
        raw = read()
        if isinstance(raw, (bytes, bytearray)):
            return bytes(raw)
    content = getattr(payload, "content", None)
    if isinstance(content, (bytes, bytearray)):
        return bytes(content)
    if isinstance(payload, str):
        return payload.encode("utf-8")
    raise RuntimeError("Unable to extract audio bytes from Groq TTS response.")


def _play_wav_bytes(wav_bytes: bytes, output_device_index: Optional[int] = None) -> None:
    if pyaudio is None:
        raise RuntimeError("Missing dependency 'pyaudio'. Install with: pip install pyaudio")
    if not wav_bytes:
        raise RuntimeError("No audio bytes were provided for playback.")

    pa = pyaudio.PyAudio()
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            stream = pa.open(
                format=pa.get_format_from_width(wf.getsampwidth()),
                channels=wf.getnchannels(),
                rate=wf.getframerate(),
                output=True,
                output_device_index=output_device_index,
            )
            try:
                while True:
                    frames = wf.readframes(2048)
                    if not frames:
                        break
                    stream.write(frames)
            finally:
                with contextlib.suppress(Exception):
                    stream.stop_stream()
                with contextlib.suppress(Exception):
                    stream.close()
    finally:
        with contextlib.suppress(Exception):
            pa.terminate()


def play_voice_preview(
    topic: str,
    *,
    groq_api_key: Optional[str] = None,
    tts_model: str = DEFAULT_GROQ_TTS_MODEL,
    tts_voice: str = DEFAULT_GROQ_TTS_VOICE,
    output_device_index: Optional[int] = None,
) -> None:
    client = _require_groq_client(groq_api_key)
    clean_topic = (topic or "").strip() or "your topic"
    script = f"Hello, I'm your teaching bot for {clean_topic}. Let's start learning!"
    response = client.audio.speech.create(
        model=tts_model,
        voice=tts_voice,
        input=script,
        response_format="wav",
    )
    audio_bytes = _coerce_audio_bytes(response)
    _play_wav_bytes(audio_bytes, output_device_index=output_device_index)


def generate_and_read_overview(
    topic: str,
    *,
    groq_api_key: Optional[str] = None,
    chat_model: str = DEFAULT_GROQ_CHAT_MODEL,
    tts_model: str = DEFAULT_GROQ_TTS_MODEL,
    tts_voice: str = DEFAULT_GROQ_TTS_VOICE,
    output_device_index: Optional[int] = None,
) -> str:
    client = _require_groq_client(groq_api_key)
    clean_topic = (topic or "").strip() or "the selected topic"
    prompt = (
        f'Provide a concise 200-word educational overview of "{clean_topic}". '
        "Write for spoken narration: no markdown, no lists, no headings. "
        "Include 1-2 concrete examples and end with one sentence that invites the learner to continue."
    )
    completion = client.chat.completions.create(
        model=chat_model,
        messages=[
            {"role": "system", "content": "You are a concise educational narrator."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.4,
        max_tokens=450,
    )
    overview = ""
    with contextlib.suppress(Exception):
        overview = (completion.choices[0].message.content or "").strip()
    if not overview:
        raise RuntimeError("Groq chat returned an empty overview.")

    speech = client.audio.speech.create(
        model=tts_model,
        voice=tts_voice,
        input=overview,
        response_format="wav",
    )
    audio_bytes = _coerce_audio_bytes(speech)
    _play_wav_bytes(audio_bytes, output_device_index=output_device_index)
    return overview


def _topic_system_prompt(topic: str) -> str:
    clean_topic = (topic or "").strip() or "the selected topic"
    return (
        f'You are a knowledgeable chat bot teaching about "{clean_topic}". '
        "Engage interactively: explain ideas, respond to queries, and ask short follow-up questions "
        "to build understanding across multiple turns. Keep responses spoken-friendly and concise."
    )


async def start_podcast_chat(
    topic: str,
    *,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    voice_name: str = "Charon",
    language: str = "English",
    input_device_index: Optional[int] = None,
    output_device_index: Optional[int] = None,
    mic_gain: float = 1.2,
    speaker_gain: float = 0.45,
    allow_barge_in: bool = True,
) -> None:
    resolved_key = (api_key or os.getenv("GEMINI_API_KEY", "")).strip()
    if not resolved_key:
        raise RuntimeError("Missing API key. Set GEMINI_API_KEY or pass api_key.")

    runtime = GeminiLiveVoiceRuntime(
        api_key=resolved_key,
        model_candidates=_unique_nonempty([model or "", *DEFAULT_MODEL_CANDIDATES]),
        voice_name=(voice_name or "Charon").strip() or "Charon",
        language_code=_normalize_language_code(language),
        system_prompt=_topic_system_prompt(topic),
        audio=AudioSettings(mic_rate=16000, speaker_rate=24000, channels=1, chunk_size=320),
        echo_gate=EchoGateSettings(),
        vad=LocalVADSettings(explicit_signals=False),
        allow_barge_in=bool(allow_barge_in),
        input_device_index=input_device_index,
        output_device_index=output_device_index,
        mic_gain=mic_gain,
        speaker_gain=speaker_gain,
        max_output_tokens=192,
        print_input_transcript=True,
        hello_loops=1,
        hello_only=False,
        skip_hello_test=True,
        enable_affective_dialog=False,
    )
    try:
        await runtime.run()
    finally:
        await runtime.close()


def _build_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Gemini Live full-duplex voice assistant with continuous mic streaming, "
            "barge-in, session resumption, and context compression."
        )
    )
    parser.add_argument("--api-key", default=os.getenv("GEMINI_API_KEY", "").strip())
    parser.add_argument(
        "--topic",
        default=os.getenv("AUTOLEARN_TOPIC", "").strip(),
        help="Teaching topic for podcast mode (used in the system instruction).",
    )
    parser.add_argument(
        "--preview-topic",
        default="",
        help="Generate and play a Groq TTS voice preview for this topic, then exit.",
    )
    parser.add_argument(
        "--overview-topic",
        default="",
        help="Generate a Groq text overview, read it with Groq TTS, then exit.",
    )
    parser.add_argument("--groq-api-key", default=os.getenv("GROQ_API_KEY", "").strip())
    parser.add_argument("--groq-chat-model", default=DEFAULT_GROQ_CHAT_MODEL)
    parser.add_argument("--groq-tts-model", default=DEFAULT_GROQ_TTS_MODEL)
    parser.add_argument("--groq-tts-voice", default=DEFAULT_GROQ_TTS_VOICE)
    parser.add_argument(
        "--model",
        default=os.getenv("GEMINI_LIVE_MODEL", "").strip(),
        help="Preferred model candidate (tried first).",
    )
    parser.add_argument("--voice", default=os.getenv("GEMINI_LIVE_VOICE", "Charon"))
    parser.add_argument("--system-prompt", default=DEFAULT_SYSTEM_PROMPT)
    parser.add_argument(
        "--language",
        default="English",
        help="Primary spoken output language (default: English).",
    )
    parser.add_argument(
        "--allow-multilingual",
        action="store_true",
        help="Allow the model to switch languages automatically.",
    )
    parser.add_argument("--chunk-size", type=int, default=320)
    parser.add_argument("--mic-rate", type=int, default=16000)
    parser.add_argument("--speaker-rate", type=int, default=24000)
    parser.add_argument("--hello-loops", type=int, default=1)
    parser.add_argument("--hello-only", action="store_true")
    parser.add_argument("--skip-hello-test", action="store_true")
    parser.add_argument(
        "--list-audio-devices",
        action="store_true",
        help="List available input/output audio devices and exit.",
    )
    parser.add_argument(
        "--input-device-index",
        type=int,
        default=-1,
        help="PyAudio input device index (default: system default input).",
    )
    parser.add_argument(
        "--output-device-index",
        type=int,
        default=-1,
        help="PyAudio output device index (default: system default output).",
    )
    parser.add_argument(
        "--speaker-gain",
        type=float,
        default=0.50,
        help="Output gain multiplier (lower reduces echo loops; default 0.50).",
    )
    parser.add_argument(
        "--mic-gain",
        type=float,
        default=1.25,
        help="Input gain multiplier (higher improves pickup for quiet voices).",
    )
    parser.add_argument(
        "--disable-echo-gate",
        action="store_true",
        help="Disable local echo/noise gate. Not recommended unless using headphones.",
    )
    parser.add_argument(
        "--barge-min-rms",
        type=int,
        default=360,
        help="Minimum mic RMS while AI speaks to treat as intentional barge-in.",
    )
    parser.add_argument(
        "--barge-multiplier",
        type=float,
        default=1.9,
        help="Dynamic threshold multiplier over ambient noise floor during AI speech.",
    )
    parser.add_argument(
        "--echo-hold-ms",
        type=int,
        default=210,
        help="How long after AI audio output to keep echo gating active.",
    )
    parser.add_argument(
        "--interrupt-cooldown-ms",
        type=int,
        default=450,
        help="Cooldown after an interruption to prevent self-interrupt loops.",
    )
    parser.add_argument(
        "--allow-barge-in",
        action="store_true",
        help="Allow host speech to interrupt AI speech (may be noisy on laptop speakers).",
    )
    parser.add_argument(
        "--use-server-vad",
        action="store_true",
        help="Force server VAD (this is the default behavior).",
    )
    parser.add_argument(
        "--explicit-vad",
        action="store_true",
        help="Use local explicit VAD signaling (advanced; more tuning required).",
    )
    parser.add_argument(
        "--vad-start-rms",
        type=int,
        default=170,
        help="Local VAD start threshold when AI is not speaking.",
    )
    parser.add_argument(
        "--vad-end-rms",
        type=int,
        default=110,
        help="Local VAD end threshold to close an activity segment.",
    )
    parser.add_argument(
        "--barge-start-chunks",
        type=int,
        default=8,
        help="How many voiced chunks are required to interrupt while AI is speaking.",
    )
    parser.add_argument(
        "--quiet-input-log",
        action="store_true",
        help="Hide host input transcription lines (AI lines still shown).",
    )
    parser.add_argument(
        "--affective-dialog",
        action="store_true",
        help="Enable emotion-aware natural speaking style (uses Live API v1alpha).",
    )
    parser.add_argument(
        "--max-output-tokens",
        type=int,
        default=96,
        help="Cap per-response length to keep speech brief and less rushed.",
    )
    return parser.parse_args()


async def _async_main(args: argparse.Namespace) -> int:
    if bool(args.list_audio_devices):
        return _print_audio_devices()
    preview_topic = (args.preview_topic or "").strip()
    if preview_topic:
        try:
            await asyncio.to_thread(
                play_voice_preview,
                preview_topic,
                groq_api_key=args.groq_api_key,
                tts_model=args.groq_tts_model,
                tts_voice=args.groq_tts_voice,
                output_device_index=(None if int(args.output_device_index) < 0 else int(args.output_device_index)),
            )
            print("[preview] voice preview playback complete.")
            return 0
        except RuntimeError as err:
            print(str(err), file=sys.stderr)
            return 2

    overview_topic = (args.overview_topic or "").strip()
    if overview_topic:
        try:
            overview = await asyncio.to_thread(
                generate_and_read_overview,
                overview_topic,
                groq_api_key=args.groq_api_key,
                chat_model=args.groq_chat_model,
                tts_model=args.groq_tts_model,
                tts_voice=args.groq_tts_voice,
                output_device_index=(None if int(args.output_device_index) < 0 else int(args.output_device_index)),
            )
            print("\n[overview]")
            print(overview)
            return 0
        except RuntimeError as err:
            print(str(err), file=sys.stderr)
            return 2

    api_key = args.api_key.strip()
    if not api_key:
        print("Missing API key. Set GEMINI_API_KEY or pass --api-key.", file=sys.stderr)
        return 2

    candidates = _unique_nonempty([args.model, *DEFAULT_MODEL_CANDIDATES])
    requested_language = (args.language or "English").strip() or "English"
    language_code = _normalize_language_code(requested_language)
    base_prompt = args.system_prompt.strip() or DEFAULT_SYSTEM_PROMPT
    topic = (args.topic or "").strip()
    if topic:
        base_prompt = f"{base_prompt} {_topic_system_prompt(topic)}"
    if args.allow_multilingual:
        effective_system_prompt = base_prompt
    else:
        effective_system_prompt = (
            f"{base_prompt} "
            f"Respond naturally in {requested_language}. "
            "Do not mention language rules unless the host asks."
        )
    try:
        explicit_vad_requested = bool(args.explicit_vad) and not bool(args.use_server_vad)
        allow_barge_in = bool(args.allow_barge_in or explicit_vad_requested)
        runtime = GeminiLiveVoiceRuntime(
            api_key=api_key,
            model_candidates=candidates,
            voice_name=args.voice.strip() or "Kore",
            language_code=language_code,
            system_prompt=effective_system_prompt,
            audio=AudioSettings(
                mic_rate=max(8000, int(args.mic_rate)),
                speaker_rate=max(8000, int(args.speaker_rate)),
                channels=1,
                chunk_size=max(160, int(args.chunk_size)),
            ),
            echo_gate=EchoGateSettings(
                enabled=not bool(args.disable_echo_gate),
                output_hold_ms=max(80, int(args.echo_hold_ms)),
                barge_min_rms=max(200, int(args.barge_min_rms)),
                barge_multiplier=max(1.2, float(args.barge_multiplier)),
                noise_alpha=0.03,
                output_follow_ratio=1.35,
                output_follow_delta=90.0,
                interrupt_cooldown_ms=max(120, int(args.interrupt_cooldown_ms)),
            ),
            vad=LocalVADSettings(
                explicit_signals=explicit_vad_requested,
                start_rms=max(120, int(args.vad_start_rms)),
                end_rms=max(80, int(args.vad_end_rms)),
                start_chunks=2,
                barge_start_chunks=max(4, int(args.barge_start_chunks)),
                end_chunks=18,
                preroll_chunks=8,
                idle_end_ms=900,
            ),
            allow_barge_in=allow_barge_in,
            input_device_index=(None if int(args.input_device_index) < 0 else int(args.input_device_index)),
            output_device_index=(None if int(args.output_device_index) < 0 else int(args.output_device_index)),
            mic_gain=max(0.5, min(3.0, float(args.mic_gain))),
            speaker_gain=max(0.1, min(1.5, float(args.speaker_gain))),
            max_output_tokens=max(64, min(1024, int(args.max_output_tokens))),
            print_input_transcript=not bool(args.quiet_input_log),
            hello_loops=max(1, int(args.hello_loops)),
            hello_only=bool(args.hello_only),
            skip_hello_test=bool(args.skip_hello_test),
            enable_affective_dialog=bool(args.affective_dialog),
        )
    except RuntimeError as err:
        print(str(err), file=sys.stderr)
        return 2

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, runtime.request_stop)

    try:
        await runtime.run()
        return 0
    except RuntimeError as err:
        print(f"Runtime error: {err}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        runtime.request_stop()
        return 130
    finally:
        await runtime.close()


def main() -> None:
    args = _build_args()
    exit_code = asyncio.run(_async_main(args))
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
