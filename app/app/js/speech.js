/** Voz para la caja de lenguaje natural (Registro v2 §8.5). Fábrica con dependencia inyectada,
 *  mismo patrón que `createBackStack(win)` (back.js) y `createToaster(doc)` (toast.js), con la
 *  misma instancia global null-safe al final del módulo para que importar este fichero en Node
 *  (los tests) no explote — no hay `window` ahí.
 *
 *  `supported = !!(win.SpeechRecognition || win.webkitSpeechRecognition)`. Sin soporte, `start` no
 *  hace nada (ni crea el reconocedor ni llama a los callbacks): es una degradación silenciosa a
 *  solo texto, no un error — un navegador sin la API no es un fallo del usuario, y la UI (registro.js
 *  §8.6) ya usa `speech.supported` para no pintar el icono del micro.
 *
 *  El resultado de la voz va SIEMPRE al mismo sitio que el texto tecleado (`onResult` entrega el
 *  transcript y quien llama lo pasa a `applyNatural`, el mismo camino que Enter/blur) — un solo
 *  camino de interpretación, nunca dos.
 *
 *  El idioma del reconocimiento sale de `activeLang()` (i18n/index.js) en cada `start()`, no de un
 *  parámetro: así un cambio de idioma en Ajustes, en medio de la sesión, se respeta sin que
 *  registro.js tenga que saber nada de i18n para pedir la voz. */
import { activeLang } from "./i18n/index.js";

export function createSpeech(win) {
  const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition;
  const supported = !!Recognition;
  let recognition = null;
  return {
    supported,
    /** onResult(text): el transcript de la primera alternativa. onError(): permiso denegado u
     *  otro fallo del reconocedor — sin detalle, el llamante decide el mensaje (spec §8.6:
     *  «No se pudo usar el micro. Escríbelo.»). */
    start(onResult, onError) {
      if (!supported) return;
      recognition = new Recognition();
      recognition.lang = activeLang() === "en" ? "en-US" : "es-ES";
      // Una frase, no un dictado continuo: se para sola al detectar silencio y solo se queda con
      // la mejor alternativa — es justo lo que necesita "45,20 en el bar", no una transcripción en
      // vivo que habría que ir editando.
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (e) => onResult(e.results[0][0].transcript);
      recognition.onerror = () => onError?.();
      recognition.start();
    },
    stop() {
      recognition?.stop();
    },
  };
}

// En Node (tests) no hay window: el módulo se importa igual y la instancia se queda a null, mismo
// criterio que back.js/toast.js/recibo.js. `speech?.supported` es cómo lo consume registro.js.
export const speech = typeof window !== "undefined" ? createSpeech(window) : null;
