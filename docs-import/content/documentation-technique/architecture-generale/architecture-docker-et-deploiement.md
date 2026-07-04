Cette page decrit les quatre topologies Docker Compose disponibles et le contenu des deux Dockerfile du projet.

## Les quatre fichiers docker-compose

| Fichier | Usage | Particularites |
|---|---|---|
| `docker-compose.yml` | Production standard | Images Docker Hub `meejay/obliance-server` / `meejay/obliance-client`, `LISTEN_PORT` par defaut **3003** |
| `docker-compose.build.yml` | Build local (meme topologie que prod) | `build.context: .`, `dockerfile: server/Dockerfile` ou `client/Dockerfile` au lieu des images Hub, `LISTEN_PORT` par defaut **3000** |
| `docker-compose.dev.yml` | Override dev (hot-reload) | S'utilise en complement de `docker-compose.build.yml` |
| `docker-compose.external-db.yml` | PostgreSQL externe (ex. Unraid) | Pas de service `postgres`, images Docker Hub, port client par defaut 3000 |

### docker-compose.yml (production)

```yaml
postgres:16-alpine          # env POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD = obliance
server:
  image: meejay/obliance-server:${OBLIANCE_VERSION:-latest}
  # port interne 3001
  # env: DATABASE_URL, SESSION_SECRET, CLIENT_ORIGIN, DEFAULT_ADMIN_USERNAME/PASSWORD
  # volume: ${CUSTOM_DIR:-./custom}:/custom
client:
  image: meejay/obliance-client:${OBLIANCE_VERSION:-latest}
  ports: ["${LISTEN_PORT:-3003}:80"]
  depends_on:
    server:
      condition: service_healthy
```

Le `client` attend explicitement que `server` soit `healthy` (healthcheck HTTP, voir plus bas) avant de demarrer.

### docker-compose.build.yml

Meme topologie de services que la production, mais `server` et `client` sont **construits localement** :

```yaml
server:
  build:
    context: .
    dockerfile: server/Dockerfile
client:
  build:
    context: .
    dockerfile: client/Dockerfile
```

`LISTEN_PORT` par defaut vaut **3000** ici, contre 3003 en production — divergence constatee dans les fichiers, a garder en tete plutot qu'a supposer accidentelle sans verification aupres des mainteneurs.

### docker-compose.dev.yml (hot-reload)

Override utilise en complement de `docker-compose.build.yml` (`npm run dev` a la racine chaine les deux fichiers) :

- `postgres` expose son port sur l'hote : `5432:5432`
- `server` : `target: builder`, `command: npx tsx watch src/index.ts`, bind-mounts `./server/src` et `./shared/src`
- `client` : `target: builder`, `command: npx vite --host 0.0.0.0`, bind-mounts `./client/src` et `./shared/src`, port `5173`, env `VITE_API_URL=http://localhost:3001`

### docker-compose.external-db.yml

Pour un PostgreSQL externe (ex. instance Unraid) :

- **Pas** de service `postgres` dans ce fichier
- `server` / `client` utilisent les images Docker Hub `meejay/*`
- `DATABASE_URL` et `SESSION_SECRET` doivent etre fournis via `.env`
- Port client par defaut : 3000

## server/Dockerfile

Build multi-stage, base `node:24-alpine` pour **les deux** stages (builder et production) :

1. **Stage builder** : compile `shared` (`npm install && npm run build`), puis `server` (`npm install && tsc`)
2. **Stage production** :
   - installe uniquement les dependances de prod du server : `npm install --omit=dev`
   - `COPY` les binaires agent **pre-builds** depuis `agent/dist/` — **aucune compilation Go n'a lieu dans Docker**
   - `COPY` egalement `oblireach-desktop/` et `obli.tools/` (le symlink `obli.tools/` est contourne via un stage intermediaire `_oblitools_dist_stage/`)
   - `HEALTHCHECK` sur `http://localhost:3001/health` toutes les 30s
   - `ENTRYPOINT server/docker-entrypoint.sh`, puis `CMD node dist/src/index.js`
   - `EXPOSE 3001`

### server/docker-entrypoint.sh

Script `sh` minimal : si `/custom/.ssh` existe, il est symlink vers `/root/.ssh` (persistance des cles SSH du RMM entre recreations de conteneur), puis `exec "$@"` pour lancer la commande passee en `CMD`.

## client/Dockerfile

Build multi-stage :

1. **Stage build** : `node:24-alpine`, `npm install --workspace=client`, puis `npm run build` (qui execute `tsc -b && vite build`)
2. **Stage production** : `nginx:alpine` servant `/usr/share/nginx/html`, configure par `client/nginx.conf`
   - `HEALTHCHECK curl -sf http://localhost/` toutes les 30s
   - `EXPOSE 80`

### client/nginx.conf — routage proxy

| Location | Cible | Particularite |
|---|---|---|
| `/auth/` | `http://server:3001` | Callback Obligate SSO |
| `/api/` | `http://server:3001` | Upgrade websocket, `proxy_read_timeout` / `proxy_send_timeout` **3600s** (tunnels remote longue duree) |
| `/socket.io/` | `http://server:3001` | Upgrade websocket |
| `/health` | `http://server:3001` | — |
| `/downloads/` | `http://server:3001` | `proxy_buffering off` (streaming des gros binaires agent) |
| `/` | fallback SPA | `try_files` vers `index.html` |

Les assets statiques (`/assets/...` issus du build Vite) sont caches 1 an cote nginx.

## Images Docker Hub

Les deux images publiees sont `meejay/obliance-server` et `meejay/obliance-client`. Aucun README racine ne les documente : la seule source est les fichiers `docker-compose*.yml` et la documentation de reference du projet.