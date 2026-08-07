// Push-to-talk over the Web Speech API (Chrome). Hold the rune button or the
// Space bar; release to submit the final transcript. If the API is missing we
// hide the mic and lean on the text input.

type SpeechRecognitionCtor = new () => any

export interface VoiceHandlers {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
}

export function initVoice(handlers: VoiceHandlers): { supported: boolean } {
  const Ctor: SpeechRecognitionCtor | undefined =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
  const ptt = document.getElementById('ptt') as HTMLButtonElement
  const transcript = document.getElementById('transcript')!

  if (!Ctor) {
    ptt.style.display = 'none'
    transcript.innerHTML = '<span class="hint">Voice needs Chrome — type your orders below instead.</span>'
    return { supported: false }
  }

  let rec: any = null
  let listening = false
  let finalText = ''
  let interimText = ''

  const start = () => {
    if (listening || ptt.disabled) return
    listening = true
    finalText = ''
    interimText = ''
    ptt.classList.add('listening')
    transcript.innerHTML = '<span class="hint">Listening…</span>'
    rec = new Ctor()
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = true
    rec.onresult = (e: any) => {
      interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interimText += r[0].transcript
      }
      const shown = (finalText + ' ' + interimText).trim()
      if (shown) {
        transcript.textContent = shown
        handlers.onInterim(shown)
      }
    }
    rec.onerror = () => stop(false)
    rec.onend = () => {
      // Chrome sometimes ends early; if the button is still held, restart.
      if (listening) {
        try {
          rec.start()
        } catch {
          /* ignore */
        }
      }
    }
    try {
      rec.start()
    } catch {
      listening = false
      ptt.classList.remove('listening')
    }
  }

  const stop = (submit = true) => {
    if (!listening) return
    listening = false
    ptt.classList.remove('listening')
    try {
      rec?.stop()
    } catch {
      /* ignore */
    }
    const text = (finalText + ' ' + interimText).trim()
    if (submit && text) {
      handlers.onFinal(text)
    } else if (!text) {
      transcript.innerHTML = '<span class="hint">Hold the rune (or Space) and speak your command…</span>'
    }
  }

  ptt.addEventListener('pointerdown', () => start())
  ptt.addEventListener('pointerup', () => stop())
  ptt.addEventListener('pointerleave', () => listening && stop())
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && document.activeElement?.id !== 'order-input') {
      e.preventDefault()
      start()
    }
  })
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && document.activeElement?.id !== 'order-input') {
      e.preventDefault()
      stop()
    }
  })

  return { supported: true }
}

// Warm up mic permission from the title screen so it never interrupts play.
export async function primeMicPermission(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
  } catch {
    /* declined — text input still works */
  }
}
