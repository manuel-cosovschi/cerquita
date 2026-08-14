# Puesta en marcha

## Requisitos

- Node 22+
- pnpm 10+
- Docker (para PostGIS y Redis)

## Paso a paso

```bash
pnpm install
pnpm dev:infra                      # PostgreSQL+PostGIS y Redis
cp .env.example .env
cp .env.example apps/api/.env
```

Completá `JWT_SECRET` en ambos `.env`. Es lo único obligatorio:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```bash
pnpm build                          # compila los packages compartidos
pnpm db:migrate
pnpm db:seed
pnpm dev:api                        # http://localhost:4000/api
pnpm dev:web                        # http://localhost:3000
```

## Sin Docker

Hace falta PostgreSQL 16 **con PostGIS**. PostGIS no es opcional: el mapa, los
radios y el clustering dependen de él.

```bash
sudo apt-get install postgresql-16 postgresql-16-postgis-3
sudo -u postgres createuser cerquita --login --pwprompt
sudo -u postgres createdb -O cerquita cerquita
```

La extensión la crea la migración; no hace falta habilitarla a mano.

## Verificar que quedó bien

```bash
curl http://localhost:4000/api/health   # {"status":"ok",...}
curl http://localhost:4000/api/ready    # {"status":"ready",...}
pnpm test
```

Para ver los precios sociales en acción, entrá con `santiago@cerquita.dev`
(seguidor) y con `fran@cerquita.dev` (amigo) a la misma PS5 — contraseña
`cerquita-demo-2026`.

## Problemas frecuentes

**`type "geography" does not exist`** — la base no tiene PostGIS. Con Docker,
verificá que la imagen sea `postgis/postgis`, no `postgres`.

**`Invalid environment configuration: JWT_SECRET`** — falta el secreto o tiene
menos de 32 caracteres. Es a propósito: no hay valor por defecto.

**`Cannot find module '@cerquita/...'`** — falta `pnpm build`. Los packages se
consumen compilados.

**El mapa se ve como una grilla** — es lo esperado. No hay proveedor de tiles
configurado; poné `NEXT_PUBLIC_MAP_TILE_URL` si querés cartografía.
