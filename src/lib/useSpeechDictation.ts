import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface WindowWithSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as WindowWithSpeech;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

interface UseSpeechDictationOptions {
  lang?: string;
  onTranscriptChange: (fullText: string) => void;
}

export function useSpeechDictation({
  lang = 'en-IN',
  onTranscriptChange,
}: UseSpeechDictationOptions) {
  const [isSupported] = useState<boolean>(() => Boolean(getSpeechRecognitionCtor()));
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const prefixRef = useRef('');
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  onTranscriptChangeRef.current = onTranscriptChange;

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // Ignore stop errors if already ended
      }
    }
  }, []);

  const startListening = useCallback(
    (existingInput: string) => {
      setError(null);
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setError(
          'Voice dictation is not supported in this browser. Try Chrome, Edge, or Safari.',
        );
        return;
      }

      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore abort errors
        }
      }

      const recognition = new Ctor();
      recognition.lang = lang;
      recognition.interimResults = true;
      recognition.continuous = false;

      const trimmedExisting = existingInput.trim();
      prefixRef.current = trimmedExisting ? `${trimmedExisting} ` : '';

      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
      };

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let finalText = '';
        let interimText = '';

        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? '';
          if (result.isFinal) {
            finalText += transcript;
          } else {
            interimText += transcript;
          }
        }

        const spoken = `${finalText}${interimText}`.trim();
        onTranscriptChangeRef.current(`${prefixRef.current}${spoken}`);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        setIsListening(false);
        if (event.error === 'aborted') {
          return;
        }
        if (
          event.error === 'not-allowed' ||
          event.error === 'service-not-allowed'
        ) {
          setError(
            'Microphone access was blocked. Please allow microphone permission in your browser settings.',
          );
        } else if (event.error === 'no-speech') {
          setError('No speech detected. Tap the microphone and speak clearly.');
        } else if (event.error === 'audio-capture') {
          setError('No microphone was found on this device.');
        } else if (event.error === 'network') {
          setError('Speech service network error. Please try again.');
        } else {
          setError('Could not capture voice input. Please try again.');
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;

      try {
        recognition.start();
      } catch {
        setIsListening(false);
        recognitionRef.current = null;
        setError('Unable to start microphone. Please try again.');
      }
    },
    [lang],
  );

  const toggleListening = useCallback(
    (existingInput: string) => {
      if (isListening) {
        stopListening();
      } else {
        startListening(existingInput);
      }
    },
    [isListening, startListening, stopListening],
  );

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, []);

  return {
    isSupported,
    isListening,
    error,
    clearError: () => setError(null),
    toggleListening,
    stopListening,
  };
}
