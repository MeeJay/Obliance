Cette page documente la coexistence en base des deux generations du modele de donnees scenarios.

## Scenarios V1 — modele lineaire (deprecated, tables conservees)

Migration : `server/src/db/migrations/050_scenarios.ts`.

### Enums

```
scenario_trigger_type: 'session_login' | 'machine_boot' | 'agent_approved'
                     | 'group_join' | 'schedule_failure' | 'manual'
scenario_status: 'draft' | 'active' | 'disabled'
scenario_run_status
scenario_step_run_status
```

### Tables

- **`scenarios`** — `trigger_type`, `trigger_config` (jsonb), `target_type`/`target_ids`, `retry_policy` (jsonb), `timeout_seconds`, `variables` (jsonb).
- **`scenario_steps`** — `check_script_id` et `resolve_script_id` (FK `scripts`, `ON DELETE SET NULL`), `sort_order` — modele **lineaire** : les etapes s'enchainent dans un ordre fixe, pas de branchement conditionnel.
- **`scenario_runs`** — `device_id`, `status`, `current_step`, `variables`.
- **`scenario_step_runs`** — trace **par phase** d'une etape : `check`, `resolve`, `recheck`, avec `exit_code`/`stdout`/`stderr`/timestamps propres a chaque phase. C'est la table qui materialise le flow documente dans le CLAUDE.md du projet : check → (echec) → resolve → recheck → succes/echec final.
- **`scenario_trigger_log`** — dedup des declenchements via `unique(scenario_id, device_id, trigger_type, trigger_key)`, evite qu'un meme evenement (ex. un `machine_boot`) redeclenche plusieurs fois le meme run pour le meme device.

Ce modele V1 ne supporte que des chaines lineaires d'etapes check/resolve, sans embranchement conditionnel ni noeuds de type autre que "etape". Les tables restent en base (donnees historiques, compatibilite import) mais le modele courant est V2.

## Scenarios V2 — modele graphe

Migration : `server/src/db/migrations/074_scenarios_v2_graph.ts`. Le commentaire du fichier de migration est explicite sur la coexistence temporaire avec V1 :

> "kept around until the auto-migration job in Phase 1B runs"

Cette migration V2 est ajoutee **en parallele** de V1, sans supprimer les tables `scenario_steps`/`scenario_step_runs`.

### Extension d'enum

Ajout d'une valeur a l'enum existant `scenario_trigger_type` :

```sql
ALTER TYPE scenario_trigger_type ADD VALUE 'schedule_cron';
```

### Nouvelles tables

- **`scenario_nodes`** — `uuid`, `scenario_id`, `type` (`varchar(64)`, **pas un enum Postgres** — la validation du type de noeud est faite cote applicatif, pas en base), `label`, `config` (jsonb libre, forme validee app-side selon le `type`), `position_x`/`position_y` (coordonnees du canvas visuel cote client).
- **`scenario_edges`** — `source_node_id`, `source_handle` (permet de distinguer plusieurs sorties depuis un meme noeud), `target_node_id`, `condition` (jsonb), `sort_order`.

### Colonnes ajoutees a scenario_runs

- `current_node_id` — remplace la notion de `current_step` lineaire par un pointeur vers un noeud du graphe.
- `last_exit_code` / `last_stdout` / `last_stderr` — dernier resultat d'execution.
- `visit_counts` (jsonb) — compteur de visites par noeud, protection anti-cycle (un graphe permet des boucles, contrairement a la chaine lineaire V1).
- `remediation_count` — nombre de tentatives de remediation effectuees sur le run.
- `run_variables` (jsonb) — reserve pour une Phase 2 non implementee au moment de cette migration.

### scenario_node_runs

Remplace `scenario_step_runs` pour le modele V2 : trace **par noeud visite** plutot que par phase d'etape fixe, avec `command_id` (lien vers `command_queue`), `exit_code`, `stdout`, `stderr`, `status`. Un run V2 produit une ligne `scenario_node_runs` par noeud traverse, ce qui permet de reconstituer le chemin exact suivi dans le graphe pour un run donne (utile pour le debug d'un scenario avec branches conditionnelles).

## Extension posterieure — noeud cooldown

La migration `server/src/db/migrations/087_scenario_cooldown_node.ts` correspond a l'introduction du node type `cooldown` documente dans le CLAUDE.md du projet : une table `scenario_cooldown_state`, keyee par `(scenario_id, device_id, node_id)`, permet a plusieurs noeuds cooldown au sein d'un meme scenario d'avoir des fenetres de cooldown independantes, tandis que plusieurs triggers convergeant vers le meme noeud cooldown partagent la meme fenetre. Cette table n'a pas ete relue en detail dans cette revue (existence confirmee par le nom de fichier de migration uniquement) — a verifier directement sur le fichier avant toute modification du mecanisme de cooldown.

## Point d'attention pour toute modification du modele scenarios

Le schema V2 utilisant des colonnes `type` (varchar libre) et `config` (jsonb libre) sur `scenario_nodes` plutot que des enums/colonnes typees, **aucune contrainte de base de donnees ne protege contre un noeud de type inconnu ou mal forme** — la validation repose entierement sur le code applicatif serveur (`server/src/services/scenarioGraph.service.ts`, map `EXECUTORS`) et client (`client/src/components/scenarios/scenarioNodeRegistry.ts`, `NODE_TYPES`). Toute migration de donnees touchant `scenario_nodes.config` doit donc etre coherente avec la validation applicative courante des noeuds concernes, la base ne rejettera pas une valeur incoherente a l'insert.