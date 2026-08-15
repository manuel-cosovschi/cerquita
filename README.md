# Cerquita

Marketplace social hiperlocal. Encontrá, comprá, vendé y subastá cosas que están
cerca tuyo.

El diseño aplicado es la síntesis de dos direcciones del board exportado: **1a
(“Map first”)** para la identidad, la paleta y el mapa como pantalla principal, y
**1c (“Social commerce”)** para lo que hace que un desconocido confíe — “amigo de
Fran”, comentarios públicos, feed. Ver [`docs/design-audit.md`](docs/design-audit.md).

---

## Levantar el proyecto

Requisitos: **Node 22+**, **pnpm 10+**, **Docker** (para PostGIS y Redis).

```bash
git clone <repo> && cd cerquita
pnpm install

# 1. Infraestructura (PostgreSQL con PostGIS + Redis)
pnpm dev:infra

# 2. Configuración
cp .env.example apps/api/.env
# Completá JWT_SECRET — es lo único obligatorio:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. Base de datos
pnpm build              # compila los packages compartidos
pnpm db:migrate         # aplica migraciones
pnpm db:seed            # datos de desarrollo

# 4. Arrancar (una terminal cada uno)
pnpm dev:api            # http://localhost:4000/api
pnpm dev:web            # http://localhost:3000
pnpm dev:admin          # http://localhost:3001
pnpm dev:mobile         # Expo: escaneá el QR o apretá `w` para el navegador
```

**No hace falta ninguna credencial de terceros.** Pagos, IA, storage y push
tienen mocks funcionales. El mock de IA no es un stub: es un parser por reglas en
castellano, con tests. Las imágenes se guardan en disco y se sirven desde
`/assets`, así que subir fotos funciona sin S3.

### Usuarios de prueba

Todos con la contraseña `cerquita-demo-2026`:

| Email                   | Rol en los datos                               |
| ----------------------- | ---------------------------------------------- |
| `manuel@cerquita.dev`   | Vendedor. Da −5% a seguidores y −15% a amigos  |
| `fran@cerquita.dev`     | **Amigo** de Manuel → ve el precio de amigo    |
| `santiago@cerquita.dev` | **Sigue** a Manuel → ve el precio de seguidor  |
| `lucia@cerquita.dev`    | Sigue a Manuel y tiene amigos en común con él  |
| `bruno@cerquita.dev`    | Tienda de tecnología                           |
| `admin@cerquita.dev`    | `super_admin` — entra en la consola de `:3001` |

Abrir la misma PS5 con distintas sesiones muestra el precio cambiar:
**550.000 público · 522.500 seguidor · 467.500 amigo**. Lo decide el servidor, no
la interfaz: cerrá sesión y el precio vuelve al público.

### Qué mirar primero

1. **El mapa** (`/`) con sesión iniciada: los marcadores de amigos tienen anillo
   turquesa y el precio que ves es el tuyo.
2. **Una publicación** de Manuel como Lucía: dice _“Amigo de Fran”_ arriba de la
   reputación. Sin sesión, no dice nada — el grafo se resuelve por espectador y
   nunca se publica.
3. **Publicar** desde el botón central: el mapa de ubicación dibuja a escala el
   círculo que van a ver los compradores. El punto exacto no sale del servidor.
4. **Ofertar** en algo de Manuel, y responder desde su cuenta en `/activity`:
   aceptar, rechazar o contraofertar. Manuel además arranca con una solicitud
   de amistad de Santiago esperando respuesta ahí mismo.
5. **La consola** en `:3001` con `admin@cerquita.dev`: toda acción de moderación
   exige un motivo y queda en auditoría.

---

## Estructura

```
apps/
  api/      NestJS · monolito modular · Prisma + PostGIS
  web/      Next.js · mapa + resultados sincronizados
  admin/    Next.js · consola de moderación
  mobile/   Expo · iOS, Android y web
packages/
  design-tokens/  primitives → semantic → CSS vars / RN theme
  domain/         reglas de negocio puras y testeables
  types/          enums, entidades de red, eventos
  validation/     esquemas Zod compartidos
  utils/          Money, geo, clustering, tiempo
  api-client/     cliente tipado compartido por las tres apps
```

## Comandos

| Comando           | Qué hace                                  |
| ----------------- | ----------------------------------------- |
| `pnpm dev:infra`  | Levanta PostGIS y Redis                   |
| `pnpm build`      | Compila los packages compartidos          |
| `pnpm test`       | Corre los tests unitarios (desde la raíz) |
| `pnpm e2e`        | Tests end-to-end contra el stack real     |
| `pnpm typecheck`  | Typecheck de todo el monorepo             |
| `pnpm lint`       | ESLint                                    |
| `pnpm db:migrate` | Aplica migraciones                        |
| `pnpm db:seed`    | Carga datos de desarrollo                 |

> `pnpm test` corre desde la raíz. Los paquetes no tienen script `test` propio a
> propósito: sus globs no matcheaban nada y `pnpm -r test` reportaba éxito sin
> correr un solo test.

---

## Decisiones que valen la pena conocer

**El servidor decide el precio.** El precio que ve cada usuario depende de su
relación con el vendedor, y se resuelve en `packages/domain/src/pricing.ts`. El
checkout vuelve a calcularlo desde cero; el número que manda el cliente sólo se
compara para avisar que cambió, nunca se cobra.

**El dinero son enteros.** Todos los montos son unidades menores en enteros. No
hay punto flotante en ningún cálculo monetario, y los porcentajes viajan en
basis points hasta la interfaz.

**La ubicación exacta no sale del servidor.** Cada publicación guarda un punto
privado y otro público difuminado de forma determinística — determinística
porque un punto que se moviera en cada request se podría promediar para recuperar
el real. El serializador nunca emite el exacto y la base tiene un CHECK que
impide publicar sin ambos.

**Una sola puja puede ganar.** Las pujas corren bajo `READ COMMITTED` con
`SELECT … FOR UPDATE`. Con `SERIALIZABLE` el snapshot queda fijo y la relectura
tras el lock devuelve estado viejo — se descubrió probando dos pujas simultáneas
reales.

**El stock no puede quedar negativo.** El checkout descuenta con un UPDATE
condicional; dos compradores compitiendo por la última unidad resuelven en una
sola orden.

**Cerquita no retiene el pago.** No hay escrow, y las pantallas lo dicen en vez
de insinuar una garantía que no existe.

**El diseño es intercambiable.** Ningún componente lee un valor visual crudo:
la web usa CSS custom properties y mobile un theme derivado de los mismos
tokens. Cambiar `packages/design-tokens/src/primitives.ts` cambia las tres apps.

---

## Documentación

- [`docs/design-audit.md`](docs/design-audit.md) — el board exportado y la síntesis 1a + 1c
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — estado por fase
- [`docs/architecture.md`](docs/architecture.md) — arquitectura
- [`docs/database.md`](docs/database.md) — modelo de datos y decisiones de esquema
- [`docs/api.md`](docs/api.md) — endpoints
- [`docs/design-system.md`](docs/design-system.md) — tokens y componentes
- [`docs/product-rules.md`](docs/product-rules.md) — reglas de negocio
- [`docs/setup.md`](docs/setup.md) — puesta en marcha detallada
- [`docs/deployment.md`](docs/deployment.md) — despliegue

## Licencia

Privado.
