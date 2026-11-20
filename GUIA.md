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
| Qué | Ejemplo |
| --- | --- |
| Atleta | una línea con su nombre: `Jhon` |
| Día (opcional) | `LUNES`, `MARTES`… |
| Bloques | `Calentamiento` / `Activación`, `Principal` (o Potencia, Fuerza…), `Vuelta a la calma` |
| Gym | `Arranque → 3x6 @18 kg` (sin `@` = peso corporal; acepta `8,5`) |
| Isométrico | `Pallof → 3x3 @6”` · `Cuádriceps 45” → 3x1 @20 kg` |
| Por tiempo | `Trote suave → 1x10'` |
| Circuito | `A HBDL → 4x12 @50 kg` y `A Press de hombro → 4x10 @14 kg` |
| Pista | `4x2x200 ritmo 35'' r30'' R1'` |
| Endurance | `3x1000 a 4min/km r2'` · `3x1000 a 19km/h` |
| Parciales propios | `600 a 1:30 [2 a 28.5 · 4 a 59]` |
| Velocidad corta | `6x30` (a tope, sin tiempo) |
| Pedir resultado | agregar `marca`: `Bala → 6 tiros @4 kg marca` |
| Objetivo del día | `💡 Prioridad: …` |
