Cette page detaille les tables centrales du parc gere : groupes hierarchiques, devices et la queue de commandes push-based.

## Groupes hierarchiques â€” device_groups

Table : `device_groups` (creee dans `server/src/db/migrations/001_initial_schema.ts`).

Caracteristiques :

- Hierarchie **auto-referencee** via une colonne `parent_id` (FK sur `device_groups.id`, `ON DELETE SET NULL` â€” supprimer un groupe parent ne supprime pas les enfants, ils remontent orphelins de parent).
- `tenant_id NOT NULL` (FK vers `tenants`, `ON DELETE CASCADE`) â€” un groupe appartient toujours a un seul tenant.
- Contrainte `unique(slug, tenant_id)` â€” le slug est unique par tenant, pas globalement.
- Colonne `uuid` unique generee via `gen_random_uuid()` â€” c'est cet UUID (pas le PK numerique) qui est expose dans les URLs/API cote client.

### Closure table â€” device_group_closure

En complement de `parent_id`, la table `device_group_closure` implemente le pattern **closure table** classique pour les requetes d'ascendance/descendance sans CTE recursive :

```
device_group_closure (
  ancestor_id   integer references device_groups(id) on delete cascade,
  descendant_id integer references device_groups(id) on delete cascade,
  depth         integer,
  primary key (ancestor_id, descendant_id)
)
```

Dans un pattern closure table generique, chaque noeud possede une ligne d'auto-reference (`ancestor_id = descendant_id`, `depth = 0`) et une ligne par ancetre intermediaire jusqu'a la racine. Cela permet en principe de recuperer tous les devices d'un groupe et de ses sous-groupes recursivement (pattern utilise par les pages `GroupDetail` du client, cf. CLAUDE.md du projet) via une simple jointure filtree par `ancestor_id`, sans CTE recursive cote SQL â€” le detail exact du peuplement de cette table par le service applicatif n'a pas ete relu ligne a ligne dans cette revue.

A la creation/suppression/deplacement d'un groupe, le service applicatif doit maintenir cette table de closure en coherence avec `parent_id` â€” les deux structures sont redondantes par design (l'une pour la navigation directe parent/enfant, l'autre pour les requetes d'arborescence en profondeur).

## Devices â€” table centrale

Table : `devices` (schema initial dans `001_initial_schema.ts`, etendue par de nombreuses migrations posterieures au fil des features : privacy mode, airgap, scenarios, etc.).

Colonnes structurantes :

| Colonne | Role |
|---|---|
| `uuid` | identifiant expose cote client/API |
| `tenant_id` | FK tenant, isolation multi-tenant |
| `group_id` | FK `device_groups`, nullable, `ON DELETE SET NULL` |
| `api_key_id` | FK `agent_api_keys`, `ON DELETE SET NULL` â€” identifie via quelle cle API l'agent s'est enregistre |
| `status` | enum `device_status` â€” etat de connexion temps reel |
| `approval_status` | enum `approval_status` â€” cycle d'approbation admin |
| `approved_by` / `approved_at` | tracabilite de l'approbation |
| `last_seen_at` / `last_push_at` | timestamps de heartbeat |
| `push_interval_seconds`, `override_group_settings`, `max_missed_pushes` | config du cycle de push, overridable par device par rapport au groupe |
| `tags`, `custom_fields` | `jsonb` â€” metadonnees libres |
| `latest_metrics` | `jsonb` â€” snapshot ecrit a chaque push agent |

Index notables :

```
index (tenant_id, status)
index (tenant_id, group_id)
index (approval_status)
```

Ces index refletent les patterns de requetage principaux du listing devices : filtrage par tenant + statut (dashboard, DeviceTable), filtrage par tenant + groupe (navigation arborescente), et filtrage global sur les devices en attente d'approbation (vue admin).

`group_id` et `api_key_id` partagent le comportement `ON DELETE SET NULL` : supprimer un groupe ou une cle API ne supprime jamais de device, il devient seulement orphelin de ce lien â€” coherent avec le principe qu'un device physique existant ne doit jamais disparaitre silencieusement d'une suppression de metadonnee.

## File de commandes â€” command_queue

Table : `command_queue`, mecanisme de queue **push-based avec ACK** entre le serveur et les agents (le serveur pousse une commande, l'agent l'execute et acquitte).

Structure :

- PK `uuid`
- `type` â€” enum `command_type`
- `payload` â€” donnees de la commande (jsonb)
- `status` â€” enum `command_status`
- `priority` â€” enum `command_priority`
- Timings : `sent_at`, `acked_at`, `finished_at`, `expires_at`
- `result` â€” `jsonb`, resultat retourne par l'agent
- `retry_count` / `max_retries` â€” politique de retry
- `source_type` / `source_id` â€” lien polymorphe vers l'entite emettrice de la commande (par exemple un `script_execution`)

Le couple `source_type`/`source_id` permet de tracer l'origine d'une commande sans FK stricte vers une table unique â€” plusieurs sous-systemes du produit emettent probablement des commandes vers ce meme pipeline unifie, chacun avec son propre type de source, meme si l'exhaustivite des types de source n'a pas ete relue en detail dans cette revue. C'est ce meme pipeline `command_queue` + ACK qui sert de socle a l'orchestration des scenarios (state machine cote serveur, l'agent lui-meme ignore la notion de scenario â€” cf. page dediee aux scenarios).