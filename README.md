# Cerquita

Marketplace social hiperlocal. Encontrá, comprá, vendé y subastá cosas que están
cerca tuyo.

> **Estado del diseño.** El proyecto de Claude Design no pudo importarse: el MCP
> requiere un login interactivo que no existe en el entorno donde se construyó
> esto. Los valores visuales actuales son **provisionales** y están aislados en
> un solo archivo. Ver [`docs/design-audit.md`](docs/design-audit.md).

---

## Levantar el proyecto

Requisitos: Node 22+, pnpm 10+, Docker (para PostGIS y Redis).

```bash
git clone <repo> && cd cerquita
pnpm install

# 1. Infraestructura (PostgreSQL con PostGIS + Redis)
pnpm dev:infra

# 2. Configuración
cp .env.example .env
cp .env.example apps/api/.env
# Completá JWT_SECRET — es lo único obligatorio:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 3. Base de datos
pnpm build              # compila los packages compartidos
pnpm db:migrate         # aplica migraciones
pnpm db:seed            # datos de desarrollo

# 4. Arrancar
pnpm dev:api            # http://localhost:4000/api
pnpm dev:web            # http://localhost:3000
```

**No hace falta ninguna credencial de terceros.** Pagos, IA, storage y push
tienen mocks funcionales. El mock de IA no es un stub: es un parser por reglas
en castellano, con tests.

### Usuarios de prueba

Todos con la contraseña `cerquita-demo-2026`:

| Email | Rol en los datos |
|---|---|
| `manuel@cerquita.dev` | Vendedor. Da −5% a seguidores y −15% a amigos |
| `fran@cerquita.dev` | **Amigo** de Manuel → ve el precio de amigo |
| `santiago@cerquita.dev` | **Sigue** a Manuel → ve el precio de seguidor |
| `lucia@cerquita.dev` | Tiene una subasta en vivo |
| `bruno@cerquita.dev` | Tienda de tecnología |
| `admin@cerquita.dev` | `super_admin` |

Abriendo la misma PS5 con distintas sesiones se ve el precio cambiar:
550.000 público · 522.500 seguidor · 467.500 amigo. **Lo decide el servidor**, no
la interfaz.

---

## Estructura

```
apps/
  api/      NestJS · monolito modular · Prisma + PostGIS
  web/      Next.js · mapa + resultados sincronizados
  admin/    Next.js · panel de administración
  mobile/   Expo · iOS y Android
packages/
  design-tokens/  primitives → semantic → CSS vars
  domain/         reglas de negocio puras y testeables
  types/          enums, entidades de red, eventos
  validation/     esquemas Zod compartidos
  utils/          Money, geo, clustering, tiempo
  api-client/     cliente tipado compartido
```

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev:infra` | Levanta PostGIS y Redis |
| `pnpm build` | Compila los packages compartidos |
| `pnpm test` | Corre los tests unitarios |
| `pnpm typecheck` | Typecheck de todo el monorepo |
| `pnpm lint` | ESLint |
| `pnpm db:migrate` | Aplica migraciones |
| `pnpm db:seed` | Carga datos de desarrollo |

---

## Decisiones que valen la pena conocer

**El servidor decide el precio.** El precio que ve cada usuario depende de su
relación con el vendedor, y se resuelve en `packages/domain/src/pricing.ts`. El
checkout vuelve a calcularlo desde cero; el número que manda el cliente sólo se
compara para avisar que cambió, nunca se cobra.

**El dinero son enteros.** Todos los montos son unidades menores (centavos) en
enteros. No hay punto flotante en ningún cálculo monetario.

**La ubicación exacta no sale del servidor.** Cada publicación guarda un punto
privado y otro público difuminado de forma determinística. El serializador nunca
emite el exacto, y la base tiene un CHECK que impide publicar sin ambos.

**Una sola puja puede ganar.** Las pujas corren bajo `READ COMMITTED` con
`SELECT … FOR UPDATE`. Con `SERIALIZABLE` el snapshot queda fijo y la relectura
tras el lock devuelve estado viejo — se descubrió probando dos pujas simultáneas
reales.

**El stock no puede quedar negativo.** El checkout descuenta con un UPDATE
condicional; dos compradores compitiendo por la última unidad resuelven en una
sola orden.

**El diseño es intercambiable.** Ningún componente lee un valor visual crudo.
Cuando llegue el export, se reemplaza `packages/design-tokens/src/primitives.ts`
y nada más.

---

## Documentación

- [`docs/design-audit.md`](docs/design-audit.md) — qué pasó con el diseño y cómo desbloquearlo
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
