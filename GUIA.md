# Entto · Guía de instalación

Se hace una sola vez. Después, las actualizaciones las subo yo al repositorio y se publican solas.

## 1. Firebase (base de datos y cuentas)
1. console.firebase.google.com → proyecto `entto`.
2. **Authentication → Método de acceso:** activar **Correo electrónico/contraseña** y **Anónimo**.
3. **Authentication → Configuración → Dominios autorizados:** agregar `royitoledezma.github.io`.
4. **Firestore Database:** creada en `southamerica-east1`, modo producción.
5. **Firestore Database → Reglas:** borrar todo, pegar el contenido de `firestore.rules` y tocar **Publicar**.
   (El correo del administrador ya va escrito dentro de las reglas.)

## 2. Datos de conexión
`js/firebase-config.js` lleva el bloque `firebaseConfig` del proyecto y el correo del administrador.

## 3. Publicación (GitHub Pages)
Repositorio `entto` → **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root) → Save**.
La app queda en `https://royitoledezma.github.io/entto/`.

## 4. Primer ingreso
1. Abrir la dirección en la computadora.
2. Tocar **"Primera vez del administrador: crear cuenta"**, escribir tu correo de administrador y una contraseña.
3. En **Entrenadores**, crear las cuentas de los demás entrenadores y pasarles su correo y contraseña.
4. En **Atletas**, agregar a cada atleta y mandarle su enlace por WhatsApp.

## Cómo se usa
- **Planificar:** pegar el texto como en WhatsApp → **Convertir** → revisar → **Publicar** (o **Guardar borrador**).
- **Atleta:** abre su enlace, lo agrega a la pantalla de inicio y desde ahí entra cada día. Funciona sin internet.
- **Revisar:** tocar el nombre del atleta en la lista. Ahí también se cargan los **tests**.
- **Excel:** en Atletas → Exportar a Excel → Descargar.
- Si un enlace se filtra: **Enlace nuevo** (el anterior deja de funcionar).

## Forma de escribir
| Qué | Cómo se escribe | Ejemplo |
| --- | --- | --- |
| Atleta | una línea con su nombre | `Jhon` |
| Gym | Ejercicio → series x repeticiones x peso (o pesos por serie con -) | `Sentadilla → 4x6x60` · `Arranque → 3x3x15-18-20` |
| Isométricos | Ejercicio → series x repeticiones x tiempo” | `Pallof → 3x3x6”` |
| Carreras | series x repeticiones x distancia ritmo XX'' r micropausa R macropausa | `4x2x200 ritmo 35'' r30'' R1'` |
| Endurance | series o repeticiones x distancia a velocidad promedio r R | `2x3x1000 a 4min/km r1' R3'` · `3x1000 a 19km/h r2'` |
| Lanzamientos | Ejercicio → series x repeticiones x peso (o pesos) r R | `Bala → 3x6x4 r30'' R2'` · `Martillo → 3x6x5-4-3` |
| Saltos | Ejercicio → series x repeticiones x saltos r R | `Vallas → 3x4x5 r1' R3'` |
| Extras | circuito (misma letra), por lado (e), marca, a full, parciales, por tiempo, día, prioridad | `A Press banca → 3x8x40` · `Subida cajón → 3x4ex20` · `Bala → 3x6x4 marca` · `6x30 a full` · `600 a 1:30 [2 a 28.5 · 4 a 59]` · `Trote → 1x10'` · `LUNES` · `💡 Prioridad: …` |

La micropausa (r) y la macropausa (R) sirven en carreras, endurance, lanzamientos y saltos. El peso también se puede escribir con @: `Sentadilla → 4x6 @60 kg`.
