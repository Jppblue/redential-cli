# Preguntas frecuentes

Cada respuesta enlaza al código y a los tests que la respaldan.

La versión en inglés ([docs/faq.md](../faq.md)) es canónica; ante cualquier diferencia, gana la versión en inglés.
### ¿Cómo sabe alguien que yo realmente hice este trabajo?
El CLI no pretende saberlo: ese es precisamente el sentido del sistema de
niveles (tiers). Un bundle Attested dice: *el historial de git de esta
máquina muestra esta actividad, reclamada por esta identidad.* Anclas
parciales respaldan la afirmación (tus correos de commit se verifican
contra los correos verificados de tu cuenta, los commits firmados no se
pueden falsificar retroactivamente sin tu clave, y la cadencia de tu
actividad se verifica por consistencia en el servidor), pero nada de eso
prueba autoría, y el README nunca pretende que lo haga.

La respuesta real es lo que viene después: cualquiera puede *reclamar* un
historial, pero en Redential un reclamo puede ser desafiado: una defensa
en vivo, donde respondes preguntas generadas a partir de los propios
números de tu bundle, en tiempo real. Quien hizo el trabajo responde de
memoria. Quien copió un historial no tiene nada que recordar. Si no
pudiste haber hecho el trabajo, no puedes defenderlo, y un reclamo sin
defender queda visiblemente estacionado en el nivel más débil, etiquetado
exactamente como lo que es.

### ¿No puedo simplemente importar un montón de librerías para inflar mi lista de habilidades?
No: un simple import por sí solo rara vez etiqueta una habilidad. La
mayoría de las firmas (signatures) requieren un especificador de import
distintivo e inequívoco (no un nombre de paquete genérico compartido
entre ecosistemas) o una forma real de llamada a la API tomada de tus
propios diffs (`stripe.checkout`, no solo `import Stripe`). Consulta
[docs/signatures.md](../signatures.md) para conocer las reglas exactas de
detección y la disciplina detrás de ellas. Pero la respuesta honesta va
más allá de la precisión de la detección: este CLI únicamente produce el
nivel **Attested**, el más débil en Redential, etiquetado explícitamente
como metadatos sin verificar. Inflar tu lista de habilidades te da una
lista apenas más larga en el nivel más débil; no aporta nada para Proven
o Verified, que requieren código en vivo o una sesión defendida. Manipular
metadatos para parecer impresionante en un nivel que ya está etiquetado
como "tómalo con pinzas" no es gran premio.

### ¿No puedo reproducir el historial de git de otra persona en un repositorio nuevo y reclamarlo?
Podrías fabricar marcas de tiempo de commits en un repositorio nuevo: por
eso, precisamente, los datos locales son explícitamente el nivel *más
débil*, no el más fuerte. Un historial reproducido igual tiene que
sobrevivir a varias anclas parciales: commits firmados (una firma GPG/SSH
no se puede falsificar retroactivamente sin la clave), una huella de
comportamiento (la cadencia por hora y día de la semana se compara con tu
propia actividad pública verificada, como una verificación de
consistencia blanda), una señal de forense de reescritura
(`integrity.date_forensics`: la fecha de autor de git es fácil de
falsificar, pero un script que reproduce años de historial fabricado en
una sola sesión también deja la fecha de *committer* de cada commit
agrupada en esa misma sesión; una señal heurística del lado del servidor,
no un veredicto local; consulta
[docs/schema.md](../schema.md#date_forensics-measurement-contract)), y,
por encima de todo, el bundle solo puede alcanzar el nivel **Attested**,
solo metadatos. Cualquier cosa por encima de eso requiere una defensa
NDA-safe: una sesión breve y grabada donde respondes en vivo preguntas
generadas a partir de tu propio bundle. Fabricar un historial de git es
barato; defender experiencia fabricada bajo interrogatorio, en tiempo
real, no lo es. Esa brecha es el verdadero límite de seguridad, no las
heurísticas de detección.

### ¿Qué sale exactamente de mi máquina?
El bundle: byte por byte, el JSON que imprime `redential scan --json` y
que `submit` siempre muestra completo antes de pedir tu confirmación, sin
nada agregado ni enriquecido después. Esa no es una promesa que tengas
que creer por fe:
[`test/privacy/submit-guardrail.test.ts`](../../test/privacy/submit-guardrail.test.ts)
verifica que el string literal enviado por HTTP por `submit` sea `===`
(idéntico) al string que se imprimió antes de tu confirmación, no una
reserialización de un objeto ya parseado. Cada campo está documentado en
[docs/schema.md](../schema.md), y el propio schema
(`schema/bundle.v1.json`) establece `additionalProperties: false` en
todas partes: un campo no listado invalida el bundle por construcción, no
solo por convención.

### ¿Por qué debería confiarle a un CLI el código de mi empleador?
Porque nunca toca el código de tu empleador de ninguna forma que salga de
tu laptop. Es exclusivamente local (`scan` no tiene red de forma
estructural, no simplemente sin red por defecto), es completamente open
source bajo Apache-2.0 para que puedas leer cada línea antes de
ejecutarlo, y sus afirmaciones de privacidad son
[pruebas ejecutables](../../test/privacy/) que tú mismo corres
(`npm test`), en lugar de una página de texto. No hay telemetría, no hay
analítica, no hay proceso en segundo plano: las únicas dos llamadas de
red que este CLI hace jamás son el device flow de `login` y la subida de
`submit`, y ambas requieren una acción explícita tuya. Y cada release
publicado lleva una atestación de proveniencia firmada con Sigstore que
puedes verificar (`npm audit signatures`), lo que demuestra que se
construyó a partir de este repositorio exacto, no desde la laptop de
alguien.

### ¿Qué prueba realmente "Attested"?
Honestamente, no mucho por sí solo, y eso es por diseño, no un descuido.
"Attested" significa: el historial de git local de esta persona muestra
este patrón de actividad, autodeclarado y falseable, con anclas parciales
(commits firmados, huella de comportamiento, verificaciones de
consistencia del lado del servidor) pero sin verificación independiente
del código subyacente. Nunca se etiqueta ni se mezcla visualmente con
Proven o Verified, que requieren conectar un repositorio legible (vía la
GitHub App) o defender el reclamo en vivo. Piensa en Attested como
"merece una pregunta de seguimiento", no como "verificado": todo el
diseño del CLI existe para mantener esa distinción honesta, en lugar de
dejar que un bundle de metadatos tome prestada una credibilidad que no se
ha ganado. Consulta [docs/principles.md](../principles.md) (principio 6,
"Honesto sobre la confianza") para el razonamiento completo.

### ¿Esto es solo un embudo para su SaaS?
La respuesta honesta: el CLI es la capa de captura open source de
[Redential](https://redential.com), y Redential es un producto comercial.
Ninguno de esos hechos está oculto: los estás leyendo justo ahora.

Lo que lo convierte en una herramienta y no en un embudo: `scan` es
completamente útil de forma independiente (standalone). Sin cuenta, sin
login, sin red: analiza tu repositorio y te muestra todo lo que
encontró, localmente, para siempre, gratis. La plataforma solo entra en
juego si decides que el resultado vale la pena publicar, y nada se sube
hasta que hayas visto el payload exacto y confirmado el prompt. No hay un
modo limitado, ni un "desbloquea los resultados completos": el análisis
local ES el análisis completo.

El modelo de negocio es la plataforma de credenciales. El trabajo del CLI
es ser lo suficientemente confiable como para que consideres usarlo, y
por eso cada afirmación de privacidad en este README corresponde a una
prueba ejecutable en lugar de a una promesa.

### ¿Qué pasa con los commits en pareja o asistidos por IA?
El trabajo asistido por IA nunca se marca como menor. El bundle lleva señales honestas y acotadas sobre la participación de agentes (conteos de coautoría, booleanos de presencia de herramientas, jamás transcripts), así que nada se oculta, y la defensa evalúa lo que importa sin importar quién tipeó: si podés explicar y sostener las decisiones del trabajo publicado bajo tu nombre. Los commits en pareja heredan el modelo de git de un autor por commit: el autor del commit recibe la atribución, y el trailer no transfiere crédito de habilidades. Es una limitación real, dicha acá en vez de disimulada.
