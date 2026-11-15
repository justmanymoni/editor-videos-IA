# Verticut

Editor web de vídeos verticales **9:16** a partir de clips en bruto, con **edición basada en transcripción**: borras palabras del texto y se cortan del vídeo.

**Funciona entero en tu ordenador: no necesita ninguna API** (ni OpenAI ni Claude). La voz se transcribe con [whisper.cpp](https://github.com/ggml-org/whisper.cpp), que la propia app descarga con un botón la primera vez.

Next.js 16 + TypeScript + Tailwind 4 · FFmpeg · whisper.cpp local.

![Editor de Verticut](docs/editor.jpg)

## Qué hace

| Función                | Detalle                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interfaz tipo CapCut   | Herramientas a la izquierda (Multimedia, Audio, Texto, Plantillas, Transcripción), reproductor en el centro o a la derecha y, a su lado, los ajustes en pestañas (Vídeo, Audio, Subtítulos, Animación, Velocidad). Línea de tiempo abajo. Todos los paneles se redimensionan arrastrando sus bordes.                                                              |
| Importar               | Vídeos, fotos y audio, arrastrándolos o con el botón **+**. Los vídeos se colocan solos en la pista principal; las fotos pueden ir en la pista principal o encima como superposición.                                                                                                                                                                             |
| Silencios automáticos  | Al subir un clip se le quitan solos los silencios de más de 0,4 s (analizando el audio y los huecos de la transcripción). Se puede desactivar y deshacer.                                                                                                                                                                                                         |
| Transcripción local    | Voz a texto con marcas de tiempo por palabra, en tu ordenador, gratis y sin internet una vez instalada. Idioma por defecto: español.                                                                                                                                                                                                                              |
| Subtítulos automáticos | Se crean solos con la voz, **palabra a palabra o cada 2, 3… palabras** (lo eliges). 9 estilos rápidos y 37 fuentes con **buscador**. Se **arrastran en el vídeo** y se editan con **doble clic**. La palabra que suena se resalta con color o dentro de una **caja**, las que aún no se han dicho pueden salir **atenuadas**, y hay 11 animaciones con miniatura. |
| Textos manuales        | Escribe o **dicta** un texto y colócalo donde quieras: arrástralo, cámbiale el tamaño, gíralo o cúrvalo (arco, círculo, onda). Puede llevar **fondo** (caja de color, con esquinas redondeadas o tipo píldora) y **animación de entrada y de salida**. Se separa en bloques con barras `/` o solo, cada 1, 2 o 3 palabras.                                        |
| Plantillas             | 16 textos predefinidos con el estilo de los vídeos cortos (título impacto, palabra clave en caja, etiqueta, última hora, cómic, elegante…), cada uno con su miniatura y su animación. Se añaden con un clic y después se cambia todo.                                                                                                                             |
| Varias capas           | Los textos, superposiciones y audios que coinciden en el tiempo se apilan en filas dentro de su pista: puedes tener un título, una etiqueta y una palabra clave a la vez.                                                                                                                                                                                         |
| Tu voz                 | Botón **Grabar mi voz**: la grabación se añade a la pista de audio donde está el cursor.                                                                                                                                                                                                                                                                          |
| Cortar                 | Dividir (S), borrar lo que queda a la izquierda (Q) o a la derecha (W) del cursor y eliminar (Supr) cualquier elemento: clip, texto, subtítulo, audio o superposición.                                                                                                                                                                                            |
| Velocidad              | Acelera o ralentiza un clip, varios o todos (de 0,25× a 4×) sin cambiar el tono de la voz. Los subtítulos y la transcripción se recolocan solos.                                                                                                                                                                                                                  |
| Selección múltiple     | Arrastra un recuadro en la línea de tiempo (o Ctrl + clic, o Ctrl + A) para seleccionar varios elementos y moverlos, borrarlos, dividirlos o cambiarles fuente, color, tamaño y duración **a todos a la vez**.                                                                                                                                                    |
| Edición por texto      | En la pestaña Transcripción, selecciona palabras y pulsa **Supr**: el corte se aplica al vídeo, a la línea de tiempo y a los subtítulos. Las palabras cortadas se ven tachadas y se pueden restaurar.                                                                                                                                                             |
| Auto-limpiar           | **Silencios**, **muletillas** (eh, mm, o sea… lista editable) y **tomas repetidas**, quedándose con la última toma de cada frase.                                                                                                                                                                                                                                 |
| Tu guión               | Pega el guión que has escrito y se sincroniza con tu voz: los subtítulos usan exactamente tus palabras, ortografía y puntuación.                                                                                                                                                                                                                                  |
| Separar voz y música   | Separa la voz de la música de fondo de cada clip con IA local (sin API) para quitar la música, quitar la voz o ajustar el volumen de cada una.                                                                                                                                                                                                                    |
| Texto descargable      | La transcripción queda en el panel derecho: cópiala o descárgala en TXT, o como subtítulos SRT con tiempos.                                                                                                                                                                                                                                                       |
| Superposiciones        | Fotos, vídeos y pegatinas (PNG con transparencia) encima del vídeo: se mueven y se cambian de tamaño en el propio reproductor. Sugerencias de B-roll según lo que dices.                                                                                                                                                                                          |
| Exportar               | MP4 H.264 1080×1920 a 30 fps con subtítulos, textos y superposiciones incrustados (FFmpeg + libass), con barra de progreso y cancelación.                                                                                                                                                                                                                         |
| Proyecto               | Pantalla de inicio con los proyectos en cuadrícula, cada uno con su miniatura. Autoguardado en JSON, importación y exportación, duplicar, renombrar. Deshacer/rehacer.                                                                                                                                                                                            |
| Actualización sola     | Abriendo la app con `Verticut.bat` se descargan e instalan solas las novedades de GitHub. Ver [Actualización automática](#actualización-automática).                                                                                                                                                                                                              |

## Requisitos

- **Node.js 20** o superior.
- **FFmpeg 6 o superior** (incluye `ffprobe`):
  - Windows: `winget install Gyan.FFmpeg`, y después cierra y vuelve a abrir la terminal.
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`

Comprueba FFmpeg con `ffprobe -version` en una terminal nueva. Si no está en el `PATH`, indica sus rutas en `.env.local` con barras normales, por ejemplo `FFPROBE_PATH=C:/ffmpeg/bin/ffprobe.exe` y `FFMPEG_PATH=C:/ffmpeg/bin/ffmpeg.exe`.

## Puesta en marcha

Necesitas además [Git](https://git-scm.com) para descargar la app y recibir las actualizaciones.

```bash
git clone https://github.com/justmanymoni/editor-videos-ia.git
```

Después, para abrirla:

- **Windows**: doble clic en **`Verticut.bat`** (dentro de la carpeta descargada).
- **Mac / Linux**: ejecuta `./verticut.sh` en esa carpeta.

La primera vez instala sus componentes (tarda unos minutos); después abre sola <http://localhost:3000> en el navegador. Deja abierta la ventana negra mientras uses la app y ciérrala para apagarla.

En la pantalla de inicio pulsa **Instalar** en la tarjeta «Transcripción local» (ver abajo). Después crea un proyecto y arrastra tus clips.

`.env.local` es opcional: solo hace falta para cambiar rutas o ajustes (copia `.env.example`).

## Actualización automática

Al abrir la app con `Verticut.bat` (o `./verticut.sh`, o `npm run app`) no hay que volver a escribir `git pull` ni `npm install`:

- Al arrancar y **cada 30 segundos** comprueba si hay cambios nuevos en GitHub y los descarga.
- Los cambios de la interfaz aparecen en el navegador sin hacer nada. Si la actualización lo necesita, reinstala los componentes y reinicia la app sola: tarda unos segundos y la página abierta se recarga por sí misma con la versión nueva.
- **Nunca actualiza a mitad de una exportación o una transcripción**: espera a que termine.
- Tus proyectos, vídeos y modelos (`storage/`, `recursos/`) no se tocan.
- Si has modificado a mano algún archivo del programa, no lo pisa: avisa en la ventana y sigue con tu versión. Para guardar tus cambios aparte (`git stash`) y actualizar: `Verticut.bat --descartar`.

En la pantalla de inicio, abajo, se ve la fecha de la versión instalada.

| Opción                       | Qué hace                                                           |
| ---------------------------- | ------------------------------------------------------------------ |
| `--sin-actualizar`           | No busca actualizaciones                                           |
| `--sin-navegador`            | No abre el navegador al arrancar                                   |
| `--descartar`                | Guarda aparte tus cambios locales para poder actualizar            |
| `PORT=3001`                  | Usa otro puerto (si el 3000 está ocupado elige el siguiente libre) |
| `VERTICUT_UPDATE_SECONDS=30` | Cada cuántos segundos se comprueba (`0` lo desactiva)              |

Si prefieres arrancarla a mano, sin actualizaciones: `npm install` y `npm run dev`.

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

## Separar la voz de la música

En la pestaña **Audio** del panel derecho, pulsa **Separar voz y música** en el clip que quieras. La primera vez se descarga el modelo de separación (unos 64 MB, una sola vez); después funciona sin internet. Al terminar puedes elegir:

- **Original**: el audio tal cual.
- **Sin música**: solo la voz.
- **Sin voz**: solo la música.
- O ajustar con los deslizadores el volumen de la voz y de la música por separado.

La vista previa y el MP4 exportado usan esa mezcla. Con la voz separada, el quitado de silencios se calcula sobre la voz limpia, así que si el clip tenía música de fondo conviene pulsar **Silencios** otra vez después de separar.

Cómo funciona: se usa el modelo MDX-Net «Kim_Vocal_2» de [Ultimate Vocal Remover](https://github.com/Anjok07/ultimatevocalremovergui), ejecutado en tu ordenador con `onnxruntime-node` en un proceso aparte (`worker/separate.mjs`). El modelo extrae la voz y la música es el resto. Las dos pistas se guardan sin pérdida (FLAC) junto al clip. En la prueba, 24 segundos de audio se separaron en unos 15 segundos con 4 núcleos.

## Flujo de trabajo

1. **Importa**: arrastra vídeos, fotos o audio a la ventana o a la pestaña _Multimedia_. Los vídeos se añaden a la pista principal, se transcriben en segundo plano y **se les quitan los silencios automáticamente** (desactivable en los ajustes de «Auto-limpiar»). Con el **+** de cada archivo, o arrastrándolo a una pista, lo colocas donde quieras.
2. **Corta**: mueve el cursor amarillo (en la regla de arriba) y usa los botones de la línea de tiempo: _Dividir_ (S), _Borrar izquierda_ (Q), _Borrar derecha_ (W) y _Eliminar_ (Supr). Arrastra los bordes de un clip para recortarlo y el clip entero para moverlo.
   - **Varios a la vez**: arrastra en un hueco de las pistas para dibujar un recuadro; todo lo que toque queda seleccionado. Ctrl + clic añade o quita un elemento y Ctrl + A lo selecciona todo. Arrastrando uno se mueven todos, Supr los borra y en la pestaña de la derecha cambias su fuente, color, tamaño o duración de una vez.
3. **Subtítulos** (pestaña _Subtítulos_, a la derecha): en _Separación_ eliges si salen palabra a palabra o cada 2, 3… palabras. Elige un estilo rápido o ajusta fuente (el desplegable tiene buscador), tamaño, colores, contorno, sombra y mayúsculas.
   - **Moverlos**: arrástralos en el propio vídeo. **Cambiar su texto**: doble clic sobre el subtítulo en el vídeo.
   - **Resaltar la palabra mientras se dice**: con color o metiéndola en una **caja** (eliges el color de la caja y el del texto); se puede apagar. _Atenuar las que aún no se han dicho_ deja en gris claro las palabras pendientes, como en un karaoke.
   - **Animación** (pestaña _Animación_, cada una con su miniatura en movimiento): desvanecer, deslizar (izquierda, derecha, arriba, abajo), zoom, rebote, desenfoque, giro, máquina de escribir y caída de letras.
   - **Usar mi guión**: pega lo que escribiste y se sincroniza con tu voz.
4. **Textos** (pestaña _Texto_, a la izquierda): escribe el texto o pulsa **Dictar** para decirlo con el micrófono, y _Añadir_. Con barras se crean varios bloques seguidos: `el lobo / enfurecido / está en el bosque` son tres; o elige que se separe solo cada 1, 2 o 3 palabras. Los bloques nuevos quedan seleccionados para darles estilo a todos de una vez. Cada bloque se arrastra en el vídeo, se estira por las esquinas, se gira con el asa redonda y en _Propiedades_ se elige su duración, fuente, color y forma (recto, arco, círculo, onda).
5. **Plantillas** (pestaña _Plantillas_, a la izquierda): títulos, etiquetas y palabras clave ya diseñados. Pasa el ratón para ver cómo entran y salen; con un clic se añaden donde está el cursor (o cambian el estilo del texto seleccionado). Después, en la derecha, la pestaña _Texto_ cambia el texto, la fuente, los colores y el **fondo**, y la pestaña _Animación_ la **entrada y la salida** (desvanecer, agrandar, encoger, rebote, subir, bajar, desde un lado). Las animaciones se ven al reproducir y salen igual en el MP4.
6. **Audio**: en la pestaña _Audio_ de la izquierda importas música o pulsas **Grabar mi voz**. En la pestaña _Audio_ de la derecha está el volumen del vídeo y, para cada clip, _Separar voz y música_ con sus deslizadores.
7. **Transcripción** (pestaña _Transcripción_, a la izquierda): es el texto de lo que se dice en el vídeo. Selecciona palabras y pulsa Supr para cortarlas del vídeo, usa _Muletillas_, _Tomas repetidas_ o _Limpiar todo_, y copia o descarga el texto (_Copiar_, _TXT_, _SRT_). Si el vídeo no está en español, elige ahí el idioma (o «Detectar») y vuelve a transcribir.
8. **Velocidad** (pestaña _Velocidad_, a la derecha): elige 0,5×, 1,25×, 1,5×, 2×… o el valor que quieras con el deslizador. Con un clip seleccionado cambia solo ese; sin selección, todos. La voz conserva su tono.
9. **Exporta**: botón _Exportar_ → calidad → _Exportar MP4_. Al terminar puedes verlo y descargarlo. Los archivos quedan en `storage/exports/`.

Los botones de la barra superior colocan el reproductor **en el centro** o **a la derecha**; arrastrando los bordes entre paneles cambias su tamaño (y el botón de la flecha circular lo restablece).

Colores del texto tachado en la transcripción: rojo = corte manual, naranja = muletilla, morado = toma repetida, gris = silencio.

## Atajos de teclado

| Tecla                       | Acción                                                                          |
| --------------------------- | ------------------------------------------------------------------------------- |
| Espacio                     | Reproducir / pausar                                                             |
| S                           | Dividir en el cursor (el elemento seleccionado o el clip principal)             |
| Q                           | Borrar lo que queda a la izquierda del cursor                                   |
| W                           | Borrar lo que queda a la derecha del cursor                                     |
| Supr / Retroceso            | Eliminar la selección (palabras, clip, texto, superposición, audio o subtítulo) |
| Arrastrar en un hueco       | Seleccionar varios elementos con un recuadro                                    |
| Ctrl + clic / Shift + clic  | Añadir o quitar un elemento de la selección                                     |
| Ctrl + A                    | Seleccionar todo                                                                |
| Ctrl + Z                    | Deshacer                                                                        |
| Ctrl + Shift + Z / Ctrl + Y | Rehacer                                                                         |
| ← / →                       | Fotograma anterior / siguiente (con Shift, un segundo)                          |
| Inicio / Fin                | Principio / final                                                               |
| Ctrl + S                    | Guardar ahora                                                                   |
| Esc                         | Quitar la selección                                                             |
| ?                           | Ayuda de atajos                                                                 |

En Mac, Ctrl equivale a Cmd.

## Carpeta de recursos (fotos, vídeos y música a mano)

Por defecto es `./recursos` (cámbiala con `BROLL_DIR`). Copia ahí clips (`mp4`, `mov`…), imágenes (`jpg`, `png`, `webp`) y música (`mp3`, `wav`, `m4a`…) y pulsa el botón de recargar del panel; también puedes importarlos desde el propio panel. Se admiten subcarpetas.

Las **sugerencias de B-roll** comparan las palabras clave de cada frase con el nombre de los archivos. Pon nombres descriptivos (`playa-atardecer.mp4`, `grafico-inflacion.png`) para que funcionen.

## El proyecto en JSON

Cada proyecto se guarda en `storage/projects/<id>.json` un segundo después de cada cambio. Desde el editor puedes descargarlo o importarlo (iconos de la barra superior). Estructura:

```jsonc
{
  "version": 1,
  "id": "k3J9…",
  "name": "Mi vídeo",
  "settings": { "language": "es", "fitMode": "cover", "silenceMin": 0.4, "silencePadding": 0.1, "fillers": ["eh", "mm", "o sea"], "mainVolume": 1 },
  "media": ["<id de cada medio usado>"],
  // Pista principal: cada clip es un rango del archivo original menos sus cortes (en segundos del original)
  "clips": [{ "id": "…", "mediaId": "…", "start": 0, "end": 23.7, "speed": 1.25, "cuts": [{ "start": 1.36, "end": 1.62, "reason": "filler" }] }],
  // Superposiciones: posición (0–1) y tamaño opcionales; sin ellos cubren todo el encuadre
  "broll": [{ "id": "…", "mediaId": "…", "start": 4.0, "duration": 3, "srcIn": 0, "x": 0.3, "y": 0.25, "scale": 0.6 }],
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
    "positionX": 50,
    "positionY": 72,
    "highlight": true,
    "animationIn": "none",
    "animationOut": "none",
    "uppercase": true,
    "stripPunctuation": true,
    "wordsPerPage": 3,
    "maxCharsPerLine": 16,
    "activeScale": 1,
  },
  // Textos manuales: posición (0–1), tamaño, giro, forma ("none", "arc" o "wave"), fondo y animaciones
  "texts": [
    {
      "id": "…",
      "text": "GRATIS",
      "start": 0,
      "duration": 2,
      "x": 0.5,
      "y": 0.4,
      "rotation": -3,
      "bgColor": "#FF6B35",
      "bgRadius": 0.12,
      "animIn": "pop",
      "animOut": "zoom",
    },
  ],
  // Cambios por palabra en los subtítulos: texto, ocultar o forzar un bloque nuevo
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
    subtitle-anim.ts   Animaciones de los subtítulos (mismas fórmulas en vista previa y exportación)
    ass.ts             Generación del subtítulo ASS para FFmpeg
    text-curve.ts      Texto en arco, círculo u onda; tamaño de las superposiciones
    text-anim.ts       Animaciones de los textos (vista previa y expresiones de FFmpeg)
    text-presets.ts    Plantillas de texto
    lanes.ts           Capas dentro de una pista
    script.ts          Sincronización del guión con la voz
  lib/server/          FFmpeg, cola de trabajos, almacén de medios, transcripción, separación, exportación
  lib/client/          Store con deshacer (zustand), motor de reproducción, acciones y atajos
worker/                Separación de voz y música (onnxruntime) en un proceso aparte
scripts/start.mjs      Lanzador con actualización automática
```

- **Cola de trabajos**: la ingesta (miniatura, análisis de audio, proxy de vista previa), la transcripción y la exportación son trabajos en una cola del servidor con límite de concurrencia. El trabajo pesado se hace en procesos hijos (FFmpeg, whisper.cpp), así que ni el servidor ni la interfaz se bloquean; el navegador consulta el progreso y lo muestra en barras. Si el servidor se reinicia a mitad, el trabajo se relanza solo.
- **Vista previa**: cada clip tiene dos elementos `<video>` que se alternan; mientras uno reproduce un fragmento, el otro ya está colocado al inicio del siguiente, de modo que saltar un corte es solo cambiar cuál se ve. Los clips que el navegador no reproduce bien (HEVC de iPhone, ProRes, 4K, 10 bits) reciben un proxy H.264 ligero; la exportación usa siempre el original.
- **Exportación exacta**: los cortes se ajustan a la rejilla de 30 fps. Cada clip entra una vez en FFmpeg y vídeo y audio se filtran con la misma expresión `select`/`aselect` sobre una rejilla común de 1/30 s, así que los cortes son exactos al fotograma y el audio no se desincroniza aunque haya cientos de cortes.
- **Caja de la palabra activa**: en el ASS va en una segunda capa bajo el texto, con las mismas palabras invisibles y estilo de caja opaca (BorderStyle 3) cuya transparencia se activa solo en la palabra que suena; así libass coloca la caja exactamente detrás de la palabra. La vista previa calcula el mismo rectángulo con las métricas de la fuente.
- **Subtítulos idénticos**: la vista previa y libass usan los mismos TTF (`public/fonts`). El tamaño se convierte con las métricas reales de cada fuente (libass dimensiona como GDI), y la posición y los saltos de línea se calculan con el mismo código en los dos lados.
- **Textos manuales**: el navegador los dibuja en un lienzo (con su curva, giro y contorno) y esa misma imagen es la que se superpone en el MP4, así que salen idénticos.
- **Animaciones**: la vista previa y el archivo ASS calculan cada animación de los subtítulos con las mismas fórmulas y duraciones. Las de los textos manuales se exportan como expresiones de FFmpeg (escala, posición y fundido de la imagen del texto) generadas a partir de esas mismas fórmulas; un test comprueba que coinciden fotograma a fotograma.
- **Velocidad**: cada clip tiene su velocidad; el paso de tiempo del original al del montaje se hace en un único sitio (`timeline.ts`), así que subtítulos, transcripción y cortes la siguen. Al exportar, el vídeo se reajusta con `setpts` y el audio con `atempo` (que conserva el tono), forzando el mismo número exacto de fotogramas y muestras.
- **Sonido de la vista previa**: los vídeos de la pista principal pasan por un pequeño mezclador (Web Audio), así que el volumen se oye en el acto. De cada clip con la voz separada se prepara una sola vista previa con la voz en el canal izquierdo y la música en el derecho; el reproductor ajusta el nivel de cada canal, por lo que mover los deslizadores de voz y música no obliga a generar nada.
- **Silencios**: se combinan el análisis de volumen del audio (umbral adaptativo al ruido de fondo de cada clip) y los huecos entre palabras de la transcripción, dejando un pequeño margen junto a la voz (ajustable).

## Scripts

| Comando                       | Qué hace                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run app`                 | Abre la app y la mantiene actualizada (lo mismo que `Verticut.bat`)                                       |
| `npm run dev`                 | Servidor de desarrollo en <http://localhost:3000>, sin actualizaciones                                    |
| `npm run build` / `npm start` | Compilación y servidor de producción                                                                      |
| `npm test`                    | Tests unitarios y un test de integración que renderiza un MP4 real con FFmpeg (se omite si no hay FFmpeg) |
| `npm run typecheck`           | Comprobación de tipos                                                                                     |
| `npm run format`              | Formatea con Prettier                                                                                     |
| `npm run check`               | Tipos + formato + tests                                                                                   |

## Auditoría de la interfaz

Dos guiones recorren la app como lo haría una persona y comprueban que cada control hace algo **al instante**, tanto en el proyecto como en la vista previa:

- `scripts/audit/audit-ui.cjs`: pulsa los 225 controles (barra superior, reproductor, línea de tiempo, las pestañas de la izquierda y de la derecha, atajos de teclado, arrastres en el vídeo) y mide lo que tarda cada uno en notarse.
- `scripts/audit/audit-sound.cjs`: mueve el volumen, la voz y la música y mide el sonido que sale realmente del reproductor.

Necesitan [Playwright](https://playwright.dev) y la app en marcha con un proyecto que tenga un vídeo transcrito, una foto y una superposición:

```bash
node scripts/audit/audit-ui.cjs
```

```bash
node scripts/audit/audit-sound.cjs
```

El proyecto se deja como estaba al terminar.

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

- **«No se encuentra el ejecutable ffprobe»**: falta FFmpeg. En Windows, `winget install Gyan.FFmpeg`, cierra la app y vuelve a abrirla.
- **La app no se actualiza**: la ventana de `Verticut.bat` dice por qué (sin conexión, falta Git o has modificado archivos del programa). La fecha de la versión instalada está abajo en la pantalla de inicio.
- **El texto transcrito no tiene sentido**: el idioma no coincide con el del vídeo. Cámbialo en la pestaña _Transcripción_ (o elige «Detectar») y vuelve a transcribir.
- **Dictar o grabar no funciona**: el navegador tiene que tener permiso para usar el micrófono; para dictar hace falta además la transcripción local instalada.
- **«Instalar transcripción» en la barra superior**: falta la transcripción local. Púlsalo e instálala; mientras, puedes editar y quitar silencios igualmente.
- **La descarga del modelo falla**: comprueba la conexión y vuelve a pulsar Instalar; lo ya descargado se reutiliza.
- **Error de «Visual C++ Redistributable» (Windows)**: instálalo desde <https://aka.ms/vs/17/release/vc_redist.x64.exe>.
- **«No se encuentra el ejecutable ffmpeg»**: instala FFmpeg o indica `FFMPEG_PATH`.
- **Un clip tarda en verse**: si es HEVC/4K se está creando el proxy de vista previa; el progreso aparece sobre el vídeo.
- **La vista previa da pequeños saltos en los cortes**: es normal en el navegador; el MP4 exportado es exacto. Con `ALWAYS_PROXY=1` los saltos son más suaves.
- **Los subtítulos de un clip no salen**: espera a que termine su transcripción (el diálogo de exportación avisa si alguna está en curso).

## Licencias de las fuentes

Las fuentes de `public/fonts` son libres (Google Fonts). Con SIL Open Font License 1.1: Montserrat, Poppins, Inter, Archivo, Archivo Black, Arimo, Tinos, Roboto, Open Sans, Oswald, Anton, Bebas Neue, Playfair Display, Lora, Courier Prime, Pacifico, Dancing Script, Lobster, Bangers y Comic Neue. Con Apache 2.0: Luckiest Guy y Permanent Marker. Arimo y Tinos tienen las mismas medidas que Arial y Times New Roman. Las licencias están en `public/fonts/licenses/`.
