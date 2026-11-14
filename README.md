# Verticut

Editor web de vídeos verticales **9:16** a partir de clips en bruto, con **edición basada en transcripción**: borras palabras del texto y se cortan del vídeo.

**Funciona entero en tu ordenador: no necesita ninguna API** (ni OpenAI ni Claude). La voz se transcribe con [whisper.cpp](https://github.com/ggml-org/whisper.cpp), que la propia app descarga con un botón la primera vez.

Next.js 16 + TypeScript + Tailwind 4 · FFmpeg · whisper.cpp local.

![Editor de Verticut](docs/editor.jpg)

## Qué hace

| Función               | Detalle                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subida múltiple       | Arrastra varios mp4/mov a la vez. Cada clip aparece con miniatura, duración y estado, y se coloca en orden en la línea de tiempo.                                                                                                     |
| Silencios automáticos | Al subir un clip se le quitan solos los silencios de más de 0,4 s (analizando el audio y los huecos de la transcripción). Se puede desactivar y deshacer.                                                                             |
| Transcripción local   | Voz a texto con marcas de tiempo por palabra, en tu ordenador, gratis y sin internet una vez instalada. Idioma por defecto: español.                                                                                                  |
| Edición por texto     | Selecciona palabras (arrastrar o Shift+clic) y pulsa **Supr**: el corte se aplica al vídeo, a la línea de tiempo y a los subtítulos. Las palabras cortadas se ven tachadas y se pueden restaurar. Doble clic corrige el texto.        |
| Tu guión              | Pega el guión que has escrito y se sincroniza con tu voz: los subtítulos usan exactamente tus palabras, ortografía y puntuación.                                                                                                      |
| Texto descargable     | El texto del vídeo queda en el panel derecho: cópialo o descárgalo en TXT, o como subtítulos SRT con tiempos.                                                                                                                         |
| Auto-limpiar          | **Silencios**, **muletillas** (eh, mm, o sea… lista editable) y **tomas repetidas**, quedándose con la última toma de cada frase.                                                                                                     |
| Subtítulos TikTok     | Palabra a palabra, texto blanco con la palabra activa en amarillo `#FFE600`, fuente bold, abajo y centrado. Fuente, colores, tamaño, contorno, sombra, posición, palabras por bloque y mayúsculas configurables, con estilos rápidos. |
| Vista previa 9:16     | Reproduce la secuencia editada saltando los cortes. Clic en una palabra = salta a ese punto; la palabra que suena se resalta en la transcripción. Modo «Rellenar» o «Desenfoque» para clips horizontales.                             |
| Línea de tiempo       | Pistas de vídeo principal, B-roll, audio/música y subtítulos. Mover, recortar (bordes) y dividir (S) clips; zoom con Ctrl+rueda.                                                                                                      |
| B-roll                | Carpeta de recursos (`recursos/`) con clips e imágenes que se arrastran a la pista. Sugerencias automáticas según las palabras clave de cada frase.                                                                                   |
| Exportar              | MP4 H.264 1080×1920 a 30 fps con los subtítulos incrustados (FFmpeg + libass), con barra de progreso y cancelación.                                                                                                                   |
| Proyecto              | Autoguardado en JSON (clips, cortes, B-roll, música, guión y estilo de subtítulos). Descarga e importación del JSON. Deshacer/rehacer.                                                                                                |

## Requisitos

- **Node.js 20** o superior.
- **FFmpeg 6 o superior** (incluye `ffprobe`):
  - Windows: `winget install Gyan.FFmpeg`, y después cierra y vuelve a abrir la terminal.
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`

Comprueba FFmpeg con `ffprobe -version` en una terminal nueva. Si no está en el `PATH`, indica sus rutas en `.env.local` con barras normales, por ejemplo `FFPROBE_PATH=C:/ffmpeg/bin/ffprobe.exe` y `FFMPEG_PATH=C:/ffmpeg/bin/ffmpeg.exe`.

## Puesta en marcha

```bash
npm install
```

```bash
npm run dev
```

Abre <http://localhost:3000>. La primera vez, pulsa **Instalar** en la tarjeta «Transcripción local» (ver abajo). Después crea un proyecto y arrastra tus clips.

`.env.local` es opcional: solo hace falta para cambiar rutas o ajustes (copia `.env.example`).

Para usarlo sin recarga en caliente (más rápido):

```bash
npm run build
```

```bash
npm start
```

## Transcripción de voz a texto (local, sin API)

En la pantalla de inicio (o con la etiqueta «Instalar transcripción» de la barra superior del editor) elige un modelo y pulsa **Instalar**. La app descarga una sola vez:

- el motor **whisper.cpp** precompilado para tu sistema (unos 8 MB, desde GitHub), y
- el **modelo de voz** elegido (desde Hugging Face):

| Modelo  | Tamaño  | Cuándo usarlo                                                         |
| ------- | ------- | --------------------------------------------------------------------- |
| Preciso | ≈550 MB | Recomendado: la mejor calidad en español (`large-v3-turbo-q5_0`)      |
| Rápido  | ≈470 MB | Transcribe bastante más deprisa con algo menos de precisión (`small`) |
| Ligero  | ≈145 MB | Ordenadores modestos; comete más errores (`base`)                     |

Todo se guarda en `storage/whisper/`. A partir de ahí la transcripción funciona sin internet y sin coste. Los clips que se subieron antes de instalarla se transcriben solos al terminar. Puedes cambiar de modelo cuando quieras.

- **Windows y Linux**: el motor se descarga solo.
- **Mac**: instala antes el motor con `brew install whisper-cpp`; después el botón descarga el modelo.
- Si en Windows aparece un error sobre «Visual C++ Redistributable», instálalo desde <https://aka.ms/vs/17/release/vc_redist.x64.exe>.

El tiempo de transcripción depende del ordenador y del modelo: con «Preciso» en un portátil normal, cuenta con que tarde más o menos lo que dura el vídeo; «Rápido» y «Ligero» tardan bastante menos.

### Opcional: usar tu propia instalación de whisper.cpp

Si ya tienes whisper.cpp, indica en `.env.local` las rutas del ejecutable y del modelo:

```dotenv
WHISPER_CPP_BIN=/ruta/a/whisper.cpp/build/bin/whisper-cli
WHISPER_CPP_MODEL=/ruta/a/whisper.cpp/models/ggml-large-v3-turbo.bin
```

### Opcional: API de OpenAI

No hace falta, pero si prefieres transcribir en la nube pon en `.env.local` `OPENAI_API_KEY=sk-...` y `TRANSCRIBER=openai` (se usa el modelo `whisper-1`, el que da tiempos por palabra). Sin `TRANSCRIBER=openai`, la clave solo se usa cuando no hay transcripción local instalada. También vale cualquier API compatible cambiando `OPENAI_BASE_URL` (por ejemplo Groq con `whisper-large-v3`).

### Sobre las muletillas

Whisper tiende a «limpiar» las vacilaciones y a no escribir «eh» o «mm». Para que las conserve, se le da un texto de contexto lleno de muletillas (`TRANSCRIPTION_PROMPT`, se puede cambiar). Aun así, si alguna no aparece en el texto, el quitado de silencios la elimina igualmente porque detecta el hueco en la transcripción.

## Flujo de trabajo

1. **Sube los clips**: arrástralos a la ventana o al panel izquierdo. Se analizan y se transcriben en segundo plano; el progreso se ve en el panel y en la transcripción. En cuanto terminan, **se les quitan los silencios automáticamente** (desactivable en los ajustes de «Auto-limpiar»).
2. **Limpia más** si quieres: en el panel derecho, _Muletillas_, _Tomas repetidas_ o _Limpiar todo_. El aviso indica cuánto se ha recortado. Todo se puede deshacer o restaurar.
3. **Edita el texto**: selecciona y pulsa Supr para cortar, o usa la barra flotante (Cortar, Restaurar, Reproducir, Ocultar en subtítulos, Empezar subtítulo aquí). Las etiquetas grises entre palabras son pausas: clic para quitarlas o recuperarlas.
4. **Tu guión (opcional)**: botón _Guión_ de la barra «Texto». Pega lo que escribiste (o abre un .txt) y pulsa _Aplicar a los subtítulos_: se sincroniza con tu voz y los subtítulos usan tus palabras exactas. El guión se guarda en el proyecto.
5. **Descarga el texto**: en la barra «Texto», _Copiar_, _TXT_ (el texto del vídeo final) o _SRT_ (subtítulos con tiempos para YouTube, CapCut, etc.).
6. **Subtítulos**: pestaña _Estilo de subtítulos_: estilos rápidos, fuente, tamaño, colores del texto y de la palabra activa, contorno, sombra, posición, palabras por bloque, mayúsculas y puntuación. Lo que ves en la vista previa es lo que se incrusta en el MP4.
7. **B-roll y música**: pestañas _B-roll_ y _Música_ del panel izquierdo. Arrastra a su pista o pulsa + para añadir en el cursor.
8. **Exporta**: botón _Exportar_ → calidad → _Exportar MP4_. Al terminar puedes verlo y descargarlo. Los archivos quedan en `storage/exports/`.

Colores del texto tachado: rojo = corte manual, naranja = muletilla, morado = toma repetida, gris = silencio.

## Atajos de teclado

| Tecla                       | Acción                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Espacio                     | Reproducir / pausar                                                                  |
| S                           | Dividir en el cursor: el B-roll, audio o subtítulo seleccionado, o el clip principal |
| Supr / Retroceso            | Borrar la selección (palabras, fragmento, B-roll, audio o subtítulo)                 |
| Ctrl + Z                    | Deshacer                                                                             |
| Ctrl + Shift + Z / Ctrl + Y | Rehacer                                                                              |
| ← / →                       | Fotograma anterior / siguiente (con Shift, un segundo)                               |
| Inicio / Fin                | Principio / final                                                                    |
| Ctrl + S                    | Guardar ahora                                                                        |
| Esc                         | Quitar la selección                                                                  |
| ?                           | Ayuda de atajos                                                                      |

En Mac, Ctrl equivale a Cmd.

## Carpeta de recursos (B-roll y música)

Por defecto es `./recursos` (cámbiala con `BROLL_DIR`). Copia ahí clips (`mp4`, `mov`…), imágenes (`jpg`, `png`, `webp`) y música (`mp3`, `wav`, `m4a`…) y pulsa el botón de recargar del panel; también puedes subirlos desde el propio panel. Se admiten subcarpetas.

Las **sugerencias de B-roll** comparan las palabras clave de cada frase con el nombre de los archivos. Pon nombres descriptivos (`playa-atardecer.mp4`, `grafico-inflacion.png`) para que funcionen.

## El proyecto en JSON

Cada proyecto se guarda en `storage/projects/<id>.json` unos segundos después de cada cambio. Desde el editor puedes descargarlo o importarlo (iconos de la barra superior). Estructura:

```jsonc
{
  "version": 1,
  "id": "k3J9…",
  "name": "Mi vídeo",
  "settings": { "language": "es", "fitMode": "cover", "silenceMin": 0.4, "silencePadding": 0.1, "fillers": ["eh", "mm", "o sea"], "mainVolume": 1 },
  "media": ["<id de cada medio usado>"],
  // Pista principal: cada clip es un rango del archivo original menos sus cortes (en segundos del original)
  "clips": [{ "id": "…", "mediaId": "…", "start": 0, "end": 23.7, "cuts": [{ "start": 1.36, "end": 1.62, "reason": "filler" }] }],
  "broll": [{ "id": "…", "mediaId": "…", "start": 4.0, "duration": 3, "srcIn": 0 }],
  "audio": [{ "id": "…", "mediaId": "…", "start": 0, "duration": 18.8, "srcIn": 0, "volume": 0.25, "fadeIn": 0.5, "fadeOut": 1 }],
  "subtitles": {
    "enabled": true,
    "fontId": "montserrat-black",
    "fontSize": 86,
    "textColor": "#FFFFFF",
    "highlightColor": "#FFE600",
    "outlineColor": "#000000",
    "outlineWidth": 6,
    "shadow": 4,
    "positionY": 72,
    "uppercase": true,
    "stripPunctuation": true,
    "wordsPerPage": 3,
    "maxCharsPerLine": 16,
    "activeScale": 1,
  },
  // Correcciones por palabra: texto, ocultar en subtítulos o forzar un bloque nuevo
  "words": { "<mediaId>:<wordId>": { "text": "corregido", "hidden": false, "breakBefore": true } },
}
```

Los medios (vídeos, transcripciones y análisis de audio) están en `storage/media/<id>/`. Un JSON importado en otro equipo necesita esos mismos archivos.

## Cómo funciona

```
src/
  app/                 Páginas (lista de proyectos, editor) y API (route handlers)
  components/editor/   Interfaz: paneles, vista previa, transcripción, línea de tiempo, exportación
  lib/shared/          Lógica pura usada por cliente y servidor (y cubierta por tests)
    timeline.ts        Clips − cortes → segmentos; mapeo tiempo original ↔ tiempo editado
    edit.ts            Operaciones de edición (cortar/restaurar palabras, dividir, recortar, mover)
    cleanup.ts         Silencios, muletillas y tomas repetidas
    subtitles.ts       Bloques de subtítulos y palabra activa
    ass.ts             Generación del subtítulo ASS para FFmpeg
  lib/server/          FFmpeg, cola de trabajos, almacén de medios, transcripción, exportación
  lib/client/          Store con deshacer (zustand), motor de reproducción, acciones y atajos
```

- **Cola de trabajos**: la ingesta (miniatura, análisis de audio, proxy de vista previa), la transcripción y la exportación son trabajos en una cola del servidor con límite de concurrencia. El trabajo pesado se hace en procesos hijos (FFmpeg, whisper.cpp), así que ni el servidor ni la interfaz se bloquean; el navegador consulta el progreso y lo muestra en barras. Si el servidor se reinicia a mitad, el trabajo se relanza solo.
- **Vista previa**: cada clip tiene dos elementos `<video>` que se alternan; mientras uno reproduce un fragmento, el otro ya está colocado al inicio del siguiente, de modo que saltar un corte es solo cambiar cuál se ve. Los clips que el navegador no reproduce bien (HEVC de iPhone, ProRes, 4K, 10 bits) reciben un proxy H.264 ligero; la exportación usa siempre el original.
- **Exportación exacta**: los cortes se ajustan a la rejilla de 30 fps. Cada clip entra una vez en FFmpeg y vídeo y audio se filtran con la misma expresión `select`/`aselect` sobre una rejilla común de 1/30 s, así que los cortes son exactos al fotograma y el audio no se desincroniza aunque haya cientos de cortes.
- **Subtítulos idénticos**: la vista previa y libass usan los mismos TTF (`public/fonts`). El tamaño se convierte con las métricas reales de cada fuente (libass dimensiona como GDI), y la posición y los saltos de línea se calculan con el mismo código en los dos lados.
- **Silencios**: se combinan el análisis de volumen del audio (umbral adaptativo al ruido de fondo de cada clip) y los huecos entre palabras de la transcripción, dejando un pequeño margen junto a la voz (ajustable).

## Scripts

| Comando                       | Qué hace                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run dev`                 | Servidor de desarrollo en <http://localhost:3000>                                                         |
| `npm run build` / `npm start` | Compilación y servidor de producción                                                                      |
| `npm test`                    | Tests unitarios y un test de integración que renderiza un MP4 real con FFmpeg (se omite si no hay FFmpeg) |
| `npm run typecheck`           | Comprobación de tipos                                                                                     |
| `npm run format`              | Formatea con Prettier                                                                                     |
| `npm run check`               | Tipos + formato + tests                                                                                   |

## Variables de entorno

Todas están documentadas en [`.env.example`](.env.example). Las principales:

| Variable                                | Por defecto                 | Uso                                                                   |
| --------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| `OPENAI_API_KEY`                        | —                           | Opcional: transcripción en la nube con OpenAI                         |
| `OPENAI_BASE_URL`                       | `https://api.openai.com/v1` | Para proveedores compatibles                                          |
| `OPENAI_TRANSCRIBE_MODEL`               | `whisper-1`                 | Modelo con marcas por palabra                                         |
| `WHISPER_CPP_BIN` / `WHISPER_CPP_MODEL` | lo instalado por la app     | Tu propia instalación de whisper.cpp                                  |
| `TRANSCRIBER`                           | local si está instalada     | `openai` para forzar la API                                           |
| `DEFAULT_LANGUAGE`                      | `es`                        | Idioma de la transcripción                                            |
| `STORAGE_DIR`                           | `./storage`                 | Clips subidos, proyectos y exportaciones                              |
| `BROLL_DIR`                             | `./recursos`                | Carpeta de recursos                                                   |
| `FFMPEG_PATH` / `FFPROBE_PATH`          | `ffmpeg` / `ffprobe`        | Rutas de FFmpeg                                                       |
| `ALWAYS_PROXY`                          | `0`                         | `1` crea siempre un proxy (vista previa más fluida con muchos cortes) |
| `TRANSCRIBE_CONCURRENCY`                | `1`                         | Transcripciones simultáneas                                           |

## Solución de problemas

- **«No se encuentra el ejecutable ffprobe»**: falta FFmpeg. En Windows, `winget install Gyan.FFmpeg`, cierra todas las terminales (y VS Code) y vuelve a lanzar `npm run dev` en una nueva.
- **«Instalar transcripción» en la barra superior**: falta la transcripción local. Púlsalo e instálala; mientras, puedes editar y quitar silencios igualmente.
- **La descarga del modelo falla**: comprueba la conexión y vuelve a pulsar Instalar; lo ya descargado se reutiliza.
- **Error de «Visual C++ Redistributable» (Windows)**: instálalo desde <https://aka.ms/vs/17/release/vc_redist.x64.exe>.
- **«No se encuentra el ejecutable ffmpeg»**: instala FFmpeg o indica `FFMPEG_PATH`.
- **Un clip tarda en verse**: si es HEVC/4K se está creando el proxy de vista previa; el progreso aparece sobre el vídeo.
- **La vista previa da pequeños saltos en los cortes**: es normal en el navegador; el MP4 exportado es exacto. Con `ALWAYS_PROXY=1` los saltos son más suaves.
- **Los subtítulos de un clip no salen**: espera a que termine su transcripción (el diálogo de exportación avisa si alguna está en curso).

## Licencias de las fuentes

Las fuentes de `public/fonts` son de Google Fonts: Montserrat, Poppins, Inter, Archivo Black, Anton y Bebas Neue (SIL Open Font License 1.1) y Luckiest Guy (Apache 2.0). Sus licencias están en `public/fonts/licenses/`.
