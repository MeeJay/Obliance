Cette page decrit l'organisation des migrations Knex et le contenu du schema initial d'Obliance.

## Organisation des migrations

Toutes les migrations vivent dans `server/src/db/migrations/` : **122 fichiers `.ts`** au total.

Convention de nommage : `NNN_description.ts` avec un numero de prefixe sur 3 chiffres. Ce prefixe **n'est pas strictement unique** â€” plusieurs collisions existent dans le depot, par exemple :

```
server/src/db/migrations/010_remote_protocol_cmd_powershell.ts
server/src/db/migrations/010_oblireach_protocol.ts
```

Des collisions similaires existent sur les prefixes `025`, `026`, `027`, `028`, `030`, `031`, `068`. Knex ne trie pas par numero parse mais par **ordre alphabetique du nom de fichier complet**, donc l'ordre d'execution reste deterministe malgre le prefixe partage â€” c'est la chaine de caracteres complete qui departage (`010_oblireach_protocol.ts` avant `010_remote_protocol_cmd_powershell.ts` alphabetiquement, `o` < `r`).

**Attention** en ajoutant une nouvelle migration : ne pas assumer que le prefixe numerique seul garantit l'ordre relatif a une autre migration du meme prefixe â€” verifier l'ordre alphabetique du nom complet si l'ordre d'execution est critique (ex. FK vers une table creee par une migration au prefixe voisin).

## Configuration Knex

Fichier : `server/knexfile.ts`

Points cles :

```ts
client: 'pg',
migrations: {
  directory: isCompiled ? 'dist/src/db/migrations' : 'src/db/migrations',
  // extension .js si compile, .ts sinon
},
pool: { min: 2, max: 25 },
acquireConnectionTimeout: 20000,
schemaName: 'public'
```

Le `pool.max` a ete monte a 25 â€” un commentaire dans le fichier explique que la valeur precedente (10) saturait sous le trafic de push des agents : chaque agent connecte pousse ses metriques periodiquement, ce qui multiplie les connexions concurrentes cote serveur. L'`acquireConnectionTimeout` est fixe a 20000ms.

En environnement compile (`isCompiled`), le repertoire de migrations bascule vers `dist/src/db/migrations` â€” a garder en tete en debug si une migration modifiee en local ne semble pas prise en compte dans un conteneur Docker (le conteneur execute le JS compile, pas le TS source).

## Schema initial â€” 001_initial_schema.ts

`server/src/db/migrations/001_initial_schema.ts` est une migration monolithique unique qui pose l'integralite du schema de base. Elle cree :

### ~25 enums PostgreSQL

```
user_role, tenant_role, team_scope, team_level, approval_status, os_type,
device_status, command_type, command_status, command_priority,
script_platform, script_runtime, execution_status, execution_trigger,
update_severity, update_source, update_status, reboot_behavior,
compliance_framework, compliance_status, remote_protocol,
remote_session_status, notification_channel_type, override_mode,
alert_severity, maintenance_scope, maintenance_schedule,
report_type, report_format, report_status
```

### Tables

`session`, `users`, `tenants`, `user_tenants`, `password_reset_tokens`, `app_config`, `device_groups`, `device_group_closure`, `user_teams`, `team_memberships`, `team_permissions`, `settings`, `smtp_servers`, `notification_channels`, `notification_channel_tenants`, `notification_bindings`, `notification_log`, `live_alerts`, `maintenance_windows`, `maintenance_window_disables`, `agent_api_keys`, `devices`, `device_inventory_hardware`, `device_inventory_software`, `command_queue`, `script_categories`, `scripts`, `script_parameters`, `script_schedules`, `script_executions`, `update_policies`, `device_updates`, `config_templates`, `config_snapshots`, `compliance_policies`, `compliance_results`, `remote_sessions`, `reports`, `report_outputs`.

### Evolution de l'enum device_status

L'enum `device_status` tel que cree en 001 (lignes 24-26) ne contient que :

```
'pending' | 'online' | 'offline' | 'maintenance' | 'warning' | 'critical' | 'suspended'
```

Les valeurs `pending_uninstall`, `updating` et `update_error` documentees dans le CLAUDE.md du projet ont ete ajoutees plus tard par des migrations posterieures via `ALTER TYPE ... ADD VALUE` :

- `pending_uninstall` â†’ `server/src/db/migrations/017_pending_uninstall.ts`
- `updating` â†’ `server/src/db/migrations/043_device_status_updating.ts`
- `update_error` â†’ ajoutee par une migration posterieure non identifiee precisement dans cette passe de revue (probablement liee au meme chantier auto-update que 043 ; a confirmer sur le fichier avant de s'y referencer dans du code).

Cette progression illustre le pattern general du projet : les enums Postgres du schema initial sont etendus au fil de l'eau par des migrations `ALTER TYPE ADD VALUE`, jamais recrees â€” donc pour connaitre l'etat courant complet d'un enum, il faut grep `ALTER TYPE device_status` (ou l'enum concerne) sur l'ensemble de `server/src/db/migrations/` plutot que de se fier uniquement a `001_initial_schema.ts`.

## Portee de cette revue

Cette page couvre en detail les migrations `001`, `044`, `050`, `074`, `085` (lues integralement). Le contenu de `086_target_tenant_ids_extra.ts` est deduit du CLAUDE.md du projet et n'a pas ete verifie ligne a ligne. Les migrations `093` a `114` (device_identity_fingerprints, cves, virtualization_hosts, backup_hosts, device_metric_history, etc.) n'ont pas ete explorees au-dela de leur nom de fichier et ne sont donc pas couvertes ici.